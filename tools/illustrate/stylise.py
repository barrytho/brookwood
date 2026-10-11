#!/usr/bin/env python3
"""Turn a photograph or flat drawing into a Victorian book illustration.

Two styles, for the plates of the Brookwood guide:

  engraving    a steel/wood line engraving.  Output is a WebP whose alpha
               channel is the ink (RGB is uniform near-black), so the page can
               draw it with CSS mask-image in its own ink colour.
  watercolour  a soft topographical watercolour vignette.  Output is an RGBA
               WebP: washes on a paper tone, fading out at a ragged edge.

Usage:
  python3 stylise.py engraving   IN OUT [--width 1000] [--seed N] [--density 1.0]
  python3 stylise.py watercolour IN OUT [--width 1000] [--seed N] [--palette victorian]
  (both accept --preview PATH.png to write a copy composited on paper #ebe6d8)

The functions engrave(), watercolour(), load_image() and the save_* helpers can
also be imported.
"""

from __future__ import annotations

import argparse
import math
import sys
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage as ndi
from scipy.optimize import nnls

INK_RGB = (29, 28, 24)          # #1d1c18, the page's ink token
PAGE_PAPER = (235, 230, 216)    # #ebe6d8, the page's paper colour
WC_PAPER = (238, 233, 220)      # paper tone inside the watercolour vignette

cv2.setRNGSeed(0)


# --------------------------------------------------------------------------
# general helpers
# --------------------------------------------------------------------------

def load_image(path, width=1000):
    """Load PNG/JPEG as float32 RGB in [0, 1], resized to `width` pixels."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    im = im.convert("RGB")
    if width and im.width != width:
        h = max(1, round(im.height * width / im.width))
        im = im.resize((width, h), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blur(a, sigma):
    if sigma <= 0:
        return a
    return cv2.GaussianBlur(a, (0, 0), sigma, borderType=cv2.BORDER_REFLECT)


def noise(shape, scale, rng):
    """Smooth value noise, zero mean, unit std, feature size ~`scale` px."""
    h, w = shape
    scale = max(1.0, float(scale))
    gh, gw = int(h / scale) + 4, int(w / scale) + 4
    g = rng.standard_normal((gh, gw)).astype(np.float32)
    big = cv2.resize(g, (int(gw * scale), int(gh * scale)), interpolation=cv2.INTER_CUBIC)
    oy = int(rng.integers(0, max(1, big.shape[0] - h)))
    ox = int(rng.integers(0, max(1, big.shape[1] - w)))
    n = big[oy:oy + h, ox:ox + w]
    n = blur(n, scale * 0.3)
    return (n - n.mean()) / (n.std() + 1e-6)


def fbm(shape, scales, weights, rng):
    out = np.zeros(shape, np.float32)
    for s, wt in zip(scales, weights):
        out += wt * noise(shape, s, rng)
    return (out - out.mean()) / (out.std() + 1e-6)


def lightness(rgb):
    """CIE L* / 100 of a float RGB image."""
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2Lab)[..., 0] / 100.0


def grad(a):
    gx = cv2.Sobel(a, cv2.CV_32F, 1, 0, ksize=3, scale=0.125)
    gy = cv2.Sobel(a, cv2.CV_32F, 0, 1, ksize=3, scale=0.125)
    return gx, gy


def _tensor(L, sigma_g, sigma_t):
    gx, gy = grad(blur(L, sigma_g))
    j = [blur(gx * gx, sigma_t), blur(gx * gy, sigma_t), blur(gy * gy, sigma_t)]
    ref = float(np.percentile(j[0] + j[2], 95)) + 1e-8
    return [c / ref for c in j]


def orientation_field(L, scales=((1.5, 8.0, 0.35), (3.0, 18.0, 0.65)),
                      bias_angle=0.0, bias_weight=0.05):
    """Hatching direction (radians) along isophotes, from a multi-scale
    smoothed structure tensor (scales = (sigma_grad, sigma_tensor, weight) in
    px).  Areas without structure relax towards `bias_angle`."""
    jxx = jxy = jyy = 0.0
    for sg, stn, wt in scales:
        a, b, c = _tensor(L, sg, stn)
        jxx, jxy, jyy = jxx + wt * a, jxy + wt * b, jyy + wt * c
    # the bias tensor encodes a gradient perpendicular to the bias tangent
    nx, ny = -math.sin(bias_angle), math.cos(bias_angle)
    jxx = jxx + bias_weight * nx * nx
    jxy = jxy + bias_weight * nx * ny
    jyy = jyy + bias_weight * ny * ny
    theta_grad = 0.5 * np.arctan2(2 * jxy, jxx - jyy)
    return (theta_grad + np.pi / 2).astype(np.float32)


def sky_mask(rgb, L):
    """Soft mask of a smooth, light sky region connected to the top edge."""
    H, W = L.shape
    sc = W / 1000.0
    gx, gy = grad(blur(L, 1.5 * sc))
    tex = blur(np.sqrt(gx * gx + gy * gy), 3 * sc)
    rb = blur(rgb, 2 * sc)
    r, g, b = rb[..., 0], rb[..., 1], rb[..., 2]
    yy = np.arange(H, dtype=np.float32)[:, None] / H
    sat = rb.max(-1) - rb.min(-1)
    skyish = ((b >= g - 0.03) & (b >= r - 0.07)) | ((L > 0.82) & (sat < 0.10))
    cand = (tex < 0.010) & (L > 0.45) & skyish & (yy < 0.85)
    cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN,
                            np.ones((3, 3), np.uint8))
    # bridge the thin breaks that cloud outlines make, for connectivity only
    k = max(3, int(9 * sc) | 1)
    bridged = cv2.morphologyEx(cand, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    n, lab = cv2.connectedComponents(bridged, connectivity=8)
    top = np.unique(lab[: max(2, int(3 * sc))])
    top = top[top > 0]
    keep = np.isin(lab, top)
    for t in top:  # ignore tiny slivers touching the top
        if (lab == t).sum() < 0.01 * H * W:
            keep &= lab != t
    if keep.sum() < 0.03 * H * W:
        return np.zeros((H, W), np.float32)
    keep &= cv2.dilate(cand, np.ones((3, 3), np.uint8)) > 0
    keep = ndi.binary_fill_holes(keep)
    keep = cv2.morphologyEx(keep.astype(np.uint8), cv2.MORPH_CLOSE,
                            np.ones((5, 5), np.uint8))
    return blur(keep.astype(np.float32), 2.0 * sc)


def foliage_mask(rgb, sky):
    """Soft mask of green vegetation."""
    H, W = sky.shape
    sc = W / 1000.0
    hsv = cv2.cvtColor(blur(rgb, 1.5 * sc), cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    green = smoothstep(55, 75, h) * (1 - smoothstep(160, 185, h))
    m = green * smoothstep(0.10, 0.22, s) * (1 - smoothstep(0.85, 0.95, v))
    m = m * (1 - sky)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return blur(m, 2.0 * sc)


def sample(a, pts):
    """Nearest-neighbour sample of 2-D array `a` at float (x, y) points."""
    h, w = a.shape
    x = np.clip(pts[:, 0].astype(np.int32), 0, w - 1)
    y = np.clip(pts[:, 1].astype(np.int32), 0, h - 1)
    return a[y, x]


def _arclen(pts):
    seg = np.sqrt((np.diff(pts, axis=0) ** 2).sum(1))
    return np.concatenate(([0.0], np.cumsum(seg)))


def _breaks(s, frac, rng, knot):
    """Irregular on/off mask along a line, visible for about `frac` of it."""
    nk = int(s[-1] / knot) + 3
    u = rng.uniform(0, 1, nk)
    val = np.interp(s / knot + rng.uniform(), np.arange(nk), u)
    return val < frac


# --------------------------------------------------------------------------
# stroke rendering
#
# Strokes are centre-lines with a width at every point.  They are rasterised
# exactly: centre-line samples go into a supersampled grid, a distance
# transform finds each pixel's nearest centre-line sample, and the pixel is
# inked where its distance is under that sample's half-width (with a one
# sub-pixel antialiasing ramp).  This keeps hairlines as thin as asked, which
# polygon filling at this scale does not.
# --------------------------------------------------------------------------

class Segs:
    """Accumulates stroke segments: start/end points and widths (output px)."""

    def __init__(self):
        self.p0, self.p1, self.w0, self.w1 = [], [], [], []

    def add_arrays(self, p0, p1, w0, w1):
        if len(p0):
            self.p0.append(np.asarray(p0, np.float32).reshape(-1, 2))
            self.p1.append(np.asarray(p1, np.float32).reshape(-1, 2))
            self.w0.append(np.asarray(w0, np.float32).ravel())
            self.w1.append(np.asarray(w1, np.float32).ravel())

    def add_strokes(self, strokes, wmin=0.3, taper=2.5):
        """strokes: iterable of (pts (N,2), widths (N,)).  Each run where the
        width exceeds wmin becomes a stroke that tapers to a point at both
        ends, as a burin line does."""
        P0, P1, W0, W1 = [], [], [], []
        for pts, w in strokes:
            if len(pts) < 2:
                continue
            on = (w > wmin).astype(np.int8)
            if not on.any():
                continue
            edges = np.flatnonzero(np.diff(np.concatenate(([0], on, [0]))))
            for a, b in zip(edges[::2], edges[1::2]):
                if b - a < 2:
                    continue
                p = pts[a:b]
                s = _arclen(p)
                total = s[-1]
                if total < 0.5:
                    continue
                t = np.minimum(s, total - s)
                ww = w[a:b] * np.clip((t + 0.3) / taper, 0.0, 1.0) ** 0.7
                P0.append(p[:-1]); P1.append(p[1:]); W0.append(ww[:-1]); W1.append(ww[1:])
        if P0:
            self.add_arrays(np.concatenate(P0), np.concatenate(P1),
                            np.concatenate(W0), np.concatenate(W1))

    def render(self, H, W, S=3):
        """Coverage (float32 HxW, 0..1)."""
        if not self.p0:
            return np.zeros((H, W), np.float32)
        p0 = np.concatenate(self.p0); p1 = np.concatenate(self.p1)
        w0 = np.concatenate(self.w0); w1 = np.concatenate(self.w1)
        seg = np.sqrt(((p1 - p0) ** 2).sum(1))
        K = int(min(64, max(2, math.ceil(float(seg.max()) * S * 1.6))))
        t = (np.arange(K, dtype=np.float32) / K)[None, :]
        x = (p0[:, :1] + (p1[:, :1] - p0[:, :1]) * t).ravel()
        y = (p0[:, 1:] + (p1[:, 1:] - p0[:, 1:]) * t).ravel()
        w = (w0[:, None] + (w1 - w0)[:, None] * t).ravel()
        ix = (x * S).astype(np.int32)
        iy = (y * S).astype(np.int32)
        ok = (ix >= 0) & (iy >= 0) & (ix < W * S) & (iy < H * S) & (w > 0)
        ix, iy, w = ix[ok], iy[ok], w[ok]
        o = np.argsort(w, kind="stable")          # widest sample wins a cell
        src = np.full((H * S, W * S), 255, np.uint8)
        wr = np.zeros((H * S, W * S), np.float32)
        src[iy[o], ix[o]] = 0
        wr[iy[o], ix[o]] = w[o]
        dist, lab = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5,
                                                    labelType=cv2.DIST_LABEL_PIXEL)
        wz = wr[src == 0]                          # raster order = label order
        half = wz[lab - 1] * (0.5 * S)
        cov = np.clip(half - dist + 0.5, 0, 1)
        return cv2.resize(cov, (W, H), interpolation=cv2.INTER_AREA)


def touch_segments(cx, cy, ang, length, width, bend, K=7):
    """Short tapered, slightly curved strokes; returns (p0, p1, w0, w1, area)."""
    t = np.linspace(-0.5, 0.5, K)[None, :]
    ca, sa = np.cos(ang)[:, None], np.sin(ang)[:, None]
    along = t * length[:, None]
    across = bend[:, None] * (0.25 - t * t) * length[:, None]
    x = cx[:, None] + ca * along - sa * across
    y = cy[:, None] + sa * along + ca * across
    wid = width[:, None] * np.maximum(np.sin(np.pi * (t + 0.5)), 0.12) ** 0.7
    pts = np.stack([x, y], -1)
    seg = np.sqrt(((pts[:, 1:] - pts[:, :-1]) ** 2).sum(-1))
    area = (seg * 0.5 * (wid[:, 1:] + wid[:, :-1])).sum(1)
    return (pts[:, :-1].reshape(-1, 2), pts[:, 1:].reshape(-1, 2),
            wid[:, :-1].ravel(), wid[:, 1:].ravel(), area)


# --------------------------------------------------------------------------
# streamline placement (Jobard & Lefer, evenly spaced streamlines)
# --------------------------------------------------------------------------

def trace_streamlines(cos_a, sin_a, active, dsep, dtest, rng, step=1.0,
                      min_len=6.0, max_len=600.0, max_turn_deg=28.0, R=2):
    H, W = active.shape
    cs = cos_a.tolist()
    sn = sin_a.tolist()
    act = active.tolist()
    occ_t = np.zeros((H * R, W * R), np.uint8)
    occ_s = np.zeros((H * R, W * R), np.uint8)
    ot = occ_t.reshape(-1)
    osp = occ_s.reshape(-1)
    WR = W * R
    th_t = max(1, int(round(2 * dtest * R)))
    th_s = max(1, int(round(2 * dsep * 0.94 * R)))
    min_cos = math.cos(math.radians(max_turn_deg))
    half = 0.5 * step

    def integrate(x, y, dx, dy):
        pts = []
        length = 0.0
        while length < max_len:
            ix, iy = int(x), int(y)
            c = cs[iy][ix]
            s = sn[iy][ix]
            if c * dx + s * dy < 0:
                c, s = -c, -s
            mx, my = x + half * c, y + half * s
            if not (0 <= mx < W and 0 <= my < H):
                break
            c2 = cs[int(my)][int(mx)]
            s2 = sn[int(my)][int(mx)]
            if c2 * c + s2 * s < 0:
                c2, s2 = -c2, -s2
            if c2 * dx + s2 * dy < min_cos:
                break
            nx, ny = x + step * c2, y + step * s2
            if not (0 <= nx < W and 0 <= ny < H):
                break
            if not act[int(ny)][int(nx)]:
                break
            if ot[int(ny * R) * WR + int(nx * R)]:
                break
            x, y, dx, dy = nx, ny, c2, s2
            pts.append((x, y))
            length += step
        return pts

    def valid(x, y):
        if not (0 <= x < W and 0 <= y < H):
            return False
        if not act[int(y)][int(x)]:
            return False
        return not osp[int(y * R) * WR + int(x * R)]

    lines = []
    seed_every = max(1, int(dsep / step / 2))
    # coarse jittered grid of starting seeds, shuffled
    g = dsep * 2.0
    gy, gx = np.mgrid[0:H:g, 0:W:g]
    gx = (gx + rng.uniform(0, g, gx.shape)).ravel()
    gy = (gy + rng.uniform(0, g, gy.shape)).ravel()
    order = rng.permutation(len(gx))
    starts = [(float(gx[i]), float(gy[i])) for i in order]

    for sx, sy in starts:
        if not valid(sx, sy):
            continue
        queue = deque([(sx, sy)])
        while queue:
            x0, y0 = queue.popleft()
            if not valid(x0, y0):
                continue
            c = cs[int(y0)][int(x0)]
            s = sn[int(y0)][int(x0)]
            fwd = integrate(x0, y0, c, s)
            bwd = integrate(x0, y0, -c, -s)
            pts = bwd[::-1] + [(x0, y0)] + fwd
            if (len(pts) - 1) * step < min_len:
                # still mark it so the seed is not retried endlessly
                cv2.circle(occ_s, (int(x0 * R), int(y0 * R)), max(1, int(dsep * R * 0.5)), 255, -1)
                continue
            arr = np.asarray(pts, np.float32)
            ipts = np.round(arr * R).astype(np.int32)
            cv2.polylines(occ_t, [ipts], False, 255, th_t)
            cv2.polylines(occ_s, [ipts], False, 255, th_s)
            lines.append(arr)
            # candidate seeds either side
            sub = arr[::seed_every]
            d = np.gradient(arr, axis=0)[::seed_every]
            nrm = np.stack([-d[:, 1], d[:, 0]], 1)
            nrm /= np.sqrt((nrm ** 2).sum(1, keepdims=True)) + 1e-9
            for sgn in (1.0, -1.0):
                cand = sub + sgn * dsep * nrm
                queue.extend(map(tuple, cand.tolist()))
    return lines


# --------------------------------------------------------------------------
# contour extraction
# --------------------------------------------------------------------------

_NB = [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)]


def edge_chains(edge, min_len=10):
    """Trace a thin binary edge map into ordered pixel chains."""
    ys, xs = np.nonzero(edge)
    pix = set(zip(ys.tolist(), xs.tolist()))
    if not pix:
        return []
    k = np.ones((3, 3), np.float32)
    k[1, 1] = 0
    nb = cv2.filter2D(edge.astype(np.float32), -1, k, borderType=cv2.BORDER_CONSTANT)
    ends = [p for p in pix if nb[p] <= 1]
    seen = set()
    chains = []

    def walk(p):
        chain = [p]
        seen.add(p)
        y, x = p
        while True:
            for dy, dx in _NB:
                q = (y + dy, x + dx)
                if q in pix and q not in seen:
                    seen.add(q)
                    chain.append(q)
                    y, x = q
                    break
            else:
                return chain

    for p in ends:
        if p not in seen:
            c = walk(p)
            if len(c) >= min_len:
                chains.append(c)
    for p in list(pix):
        if p not in seen:
            c = walk(p)
            if len(c) >= min_len:
                chains.append(c)
    out = []
    for c in chains:
        a = np.asarray(c, np.float32)[:, ::-1] + 0.5  # (x, y)
        if len(a) >= 5:
            ker = np.ones(5, np.float32) / 5
            pad = np.pad(a, ((2, 2), (0, 0)), mode="edge")
            a = np.stack([np.convolve(pad[:, 0], ker, "valid"),
                          np.convolve(pad[:, 1], ker, "valid")], 1)
        out.append(a)
    return out


def canny_edges(rgb_u8, lo, hi):
    lab = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2Lab)
    e = cv2.Canny(lab[..., 0], lo, hi, L2gradient=True)
    e |= cv2.Canny(lab[..., 1], lo, hi, L2gradient=True)
    e |= cv2.Canny(lab[..., 2], lo, hi, L2gradient=True)
    # thin to one pixel where the channel edges sit side by side
    if hasattr(cv2, "ximgproc"):
        e = cv2.ximgproc.thinning(e)
    else:
        e = _thin(e > 0).astype(np.uint8) * 255
    return e > 0


def _thin(b):
    """Zhang-Suen thinning (vectorised), for the OR of channel edge maps."""
    img = b.astype(np.uint8).copy()
    for _ in range(4):
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P2, P3, P4 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:]
            P5, P6, P7 = p[2:, 2:], p[2:, 1:-1], p[2:, :-2]
            P8, P9 = p[1:-1, :-2], p[:-2, :-2]
            nbrs = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(n.astype(np.int32) for n in nbrs)
            seq = nbrs + [P2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.int32) for i in range(8))
            if step == 0:
                c = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            rm = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                img[rm] = 0
                changed = True
        if not changed:
            break
    return img > 0


def irregular_vignette(H, W, rng, margin=0.06, ragged=1.0, power=3.2):
    """Signed distance-like field (px, positive inside) of a ragged oval-ish
    rectangle, plus the field's px scale."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    x = (xx - W / 2) / (W / 2 * (1 - margin))
    y = (yy - H / 2) / (H / 2 * (1 - margin))
    p = power
    f = (np.abs(x) ** p + np.abs(y) ** p) ** (1 / p)
    m = min(H, W)
    f = f + ragged * (0.07 * noise((H, W), 0.22 * m, rng)
                      + 0.025 * noise((H, W), 0.06 * m, rng)
                      + 0.010 * noise((H, W), 0.018 * m, rng))
    return (1 - f) * (m / 2)


# --------------------------------------------------------------------------
# ENGRAVING
# --------------------------------------------------------------------------

def engrave(rgb, seed=0, density=1.0, vignette=True, S=3, return_parts=False):
    """Return ink coverage (float32 HxW in [0, 1]) for a float RGB image."""
    rng = np.random.default_rng(seed)
    H, W = rgb.shape[:2]
    sc = W / 1000.0

    u8 = np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8)
    sm = cv2.bilateralFilter(u8, 0, 24, 3 * sc)
    sm = cv2.bilateralFilter(sm, 0, 18, 3 * sc)
    smf = sm.astype(np.float32) / 255
    L = lightness(smf)

    # tone: local contrast, levels, gamma; T = darkness in [0, 1]
    clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(6, 6))
    Lc = clahe.apply(np.clip(L * 255, 0, 255).astype(np.uint8)).astype(np.float32) / 255
    Lt = 0.55 * L + 0.45 * Lc
    lo, hi = np.percentile(Lt, [0.8, 99.0])
    Ln = np.clip((Lt - lo) / (hi - lo + 1e-6), 0, 1)
    T = np.clip((1 - Ln - 0.06) / 0.94, 0, 1) ** 1.25
    T = blur(T, 0.8 * sc)

    sky = sky_mask(rgb, L)
    green = foliage_mask(smf, sky)
    fol = green * smoothstep(0.58, 0.47, blur(L, 2 * sc))

    if vignette:
        vd = irregular_vignette(H, W, rng, margin=0.035, ragged=0.8)
        v = smoothstep(0, 0.10 * min(H, W), vd)
    else:
        v = np.ones((H, W), np.float32)
    Tv = T * v

    theta = orientation_field(L, ((1.5 * sc, 8 * sc, 0.35), (3 * sc, 18 * sc, 0.65)))
    wfloor = 0.5 * sc            # thinnest continuous line
    wmin = 0.25 * sc

    # ---- hatching: up to three directions ---------------------------------
    hatch_m = (1 - sky) * (1 - fol)
    Th = Tv * hatch_m
    c1 = np.minimum(Th, 0.50) + 0.25 * smoothstep(0.82, 1.0, Th)
    c2 = np.clip(1 - (1 - Th) / (1 - c1 + 1e-6), 0, 0.42)
    c3 = np.clip(1 - (1 - Th) / ((1 - c1) * (1 - c2) + 1e-6), 0, 0.62)
    base = 4.0 * sc / density
    layers = [
        (c1, 0.0, base),
        (c2, math.radians(62), base * 1.06),
        (c3, math.radians(-56), base * 0.94),
    ]
    covs = []
    for li, (cmap, dtheta, dsep) in enumerate(layers):
        segs = Segs()
        active = cmap > (0.01 if li == 0 else 0.02)
        if active.sum() > 50:
            ang = theta + dtheta
            lines = trace_streamlines(np.cos(ang), np.sin(ang), active, dsep, dsep * 0.55,
                                      rng, step=1.0, min_len=dsep * 1.5)
            k = dsep * 0.88      # streamlines sit a little closer than dsep on average
            strokes = []
            for pts in lines:
                w = sample(cmap, pts) * k
                if li == 0:
                    # light tones: a hairline that breaks up irregularly, then vanishes
                    frac = np.clip(w / wfloor, 0, 1)
                    on = _breaks(_arclen(pts), frac, rng, rng.uniform(3, 7) * sc) | (frac >= 0.999)
                    w = np.where(on, np.maximum(w, wfloor), 0.0)
                strokes.append((pts, w))
            segs.add_strokes(strokes, wmin=wmin, taper=2.2 * sc)
        if li == 0 and sky.max() > 0.5:
            # ---- sky: ruled horizontal lines, fading downwards ----------------
            ssp = 5.0 * sc / density
            rows = np.flatnonzero(sky.max(1) > 0.05)
            ytop, ybot = rows.min(), rows.max()
            fade = 1 - 0.85 * np.clip((np.arange(H) - ytop) / max(1, ybot - ytop), 0, 1) ** 1.2
            Ts = (Tv * 1.1 + 0.03) * sky * fade[:, None]
            xs = np.arange(0, W, 1.0, dtype=np.float32)
            strokes = []
            y = ytop + ssp * 0.5
            while y < ybot:
                pts = np.stack([xs, np.full_like(xs, y)], 1)
                ts = sample(Ts, pts)
                w = np.where(ts > 0.04, np.maximum(ts * ssp * 0.9, wfloor * 0.9), 0.0)
                strokes.append((pts, w))
                y += ssp
            segs.add_strokes(strokes, wmin=wmin, taper=6 * sc)
        covs.append(segs.render(H, W, S))

    # ---- foliage: leaf-touches in the light, white cuts in the dark -------
    # leaf masses: clumps lit from the upper left, shadowed beneath
    clump = noise((H, W), 12 * sc, rng)
    shift = np.float32([[1, 0, 2.5 * sc], [0, 1, 3.5 * sc]])
    shade = cv2.warpAffine(clump, shift, (W, H), borderMode=cv2.BORDER_REFLECT) - clump
    shade = blur(shade, 1.0 * sc)
    shade /= shade.std() + 1e-6
    Tf = np.clip(Tv + 0.05 * shade * smoothstep(0.1, 0.4, Tv), 0, 1) * fol
    if Tf.max() > 0.05:
        solid_t = 0.66
        g = 3.0 * sc
        gy, gx = np.mgrid[0:H:g, 0:W:g].astype(np.float32)
        gx = gx.ravel() + rng.uniform(0, g, gx.size)
        gy = gy.ravel() + rng.uniform(0, g, gy.size)
        tf = sample(Tf, np.stack([gx, gy], 1))
        N = len(gx)
        m = 3                                     # strokes per touch, stacked
        flen = rng.uniform(5.0, 8.0, N) * sc
        fwid = rng.uniform(0.8, 1.2, N) * sc
        fang = rng.normal(0, 0.28, N)
        fbend = -np.abs(rng.normal(0.5, 0.15, N))

        def touches(idx, scale_len, scale_w, gap):
            out = Segs()
            area = np.zeros(len(idx))
            a = fang[idx]
            for j in range(m):
                off = (j - (m - 1) / 2) * gap * sc
                f = 1.0 - 0.22 * abs(j - (m - 1) / 2)
                p0, p1, w0, w1, ar = touch_segments(
                    gx[idx] - np.sin(a) * off, gy[idx] + np.cos(a) * off, a,
                    flen[idx] * scale_len * f, fwid[idx] * scale_w, fbend[idx])
                out.add_arrays(p0, p1, w0, w1)
                area += ar
            return out, area

        # the area of every candidate touch, for Poisson coverage
        _, area_all = touches(np.arange(N), 1.0, 1.0, 2.2)
        lt = np.clip(tf / solid_t, 0, 1) * 0.62
        prob = -np.log(1 - lt) / area_all * g * g
        k = np.flatnonzero((rng.uniform(0, 1, N) < prob) & (tf > 0.05))
        segs, _ = touches(k, 1.0, 1.0, 2.2)
        black = segs.render(H, W, S)
        solid = np.clip((Tf - solid_t) / 0.04 + 0.5, 0, 1)
        light = 1 - np.clip((tf - solid_t) / 0.30, 0, 1)
        prob = -np.log(1 - 0.40 * light) / (area_all * 0.75) * g * g
        k = np.flatnonzero((rng.uniform(0, 1, N) < prob) & (tf > solid_t - 0.02))
        segs, _ = touches(k, 0.9, 0.85, 2.0)
        cut = segs.render(H, W, S)
        covs.append(np.maximum(black, solid) * (1 - cut))

    # ---- contours ----------------------------------------------------------
    edges = canny_edges(sm, 40, 110)
    edges &= ~(cv2.erode((sky > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    chains = edge_chains(edges, min_len=int(8 * sc) + 2)
    gx_, gy_ = grad(blur(L, 1.0 * sc))
    strength = np.clip(np.sqrt(gx_ ** 2 + gy_ ** 2) / 0.06, 0, 1)
    Tmax = cv2.dilate(T, np.ones((5, 5), np.uint8))
    wc = (0.45 + 0.9 * strength) * (0.55 + 0.6 * Tmax) * v * (1 - 0.35 * fol) * sc
    segs = Segs()
    segs.add_strokes([(c, sample(wc, c)) for c in chains], wmin=0.35 * sc, taper=3.0 * sc)
    covs.append(segs.render(H, W, S))

    cov = np.maximum.reduce(covs)
    if return_parts:
        return cov, dict(T=T, sky=sky, fol=fol, theta=theta, v=v)
    return cov


def _save_webp(rgba_u8, out, quality, max_kb, alpha_qualities):
    """Save, lowering alpha quality until the file fits under max_kb."""
    im = Image.fromarray(rgba_u8, "RGBA")
    for aq in alpha_qualities:
        im.save(out, "WEBP", quality=quality, alpha_quality=aq, method=6)
        if max_kb is None or Path(out).stat().st_size <= max_kb * 1024:
            break
    return aq


def save_engraving(cov, out, preview=None, quality=80, max_kb=None):
    H, W = cov.shape
    rgba = np.empty((H, W, 4), np.uint8)
    rgba[..., :3] = INK_RGB
    rgba[..., 3] = np.clip(cov * 255 + 0.5, 0, 255).astype(np.uint8)
    _save_webp(rgba, out, quality, max_kb, (100, 90, 80, 70, 60, 50))
    if preview:
        paper = np.array(PAGE_PAPER, np.float32)
        ink = np.array(INK_RGB, np.float32)
        c = paper * (1 - cov[..., None]) + ink * cov[..., None]
        Image.fromarray(np.clip(c + 0.5, 0, 255).astype(np.uint8)).save(preview)


# --------------------------------------------------------------------------
# WATERCOLOUR
# --------------------------------------------------------------------------

# Approximate RGB transmittance of a moderate wash of each pigment on white,
# and how strongly it granulates, and a cost that keeps the palette restrained.
PIGMENTS = {
    #               rgb                 gran  cost
    "yellow_ochre":  ((0.84, 0.68, 0.36), 0.35, 1.0),
    "burnt_sienna":  ((0.74, 0.45, 0.28), 0.55, 1.0),
    "sepia":         ((0.50, 0.41, 0.33), 0.45, 1.1),
    "sap_green":     ((0.52, 0.60, 0.27), 0.20, 1.1),
    "prussian_blue": ((0.28, 0.42, 0.56), 0.15, 1.5),
    "paynes_grey":   ((0.42, 0.46, 0.52), 0.70, 1.15),
    "light_red":     ((0.80, 0.48, 0.38), 0.45, 1.4),
    "rose_madder":   ((0.88, 0.60, 0.62), 0.10, 2.0),
    "cerulean":      ((0.52, 0.70, 0.82), 0.85, 1.3),
}
PALETTES = {
    "victorian": list(PIGMENTS),
    "sepia": ["sepia", "yellow_ochre", "paynes_grey", "burnt_sienna"],
}


def _pigment_lut(names, n=24, lam=0.03):
    K = np.stack([-np.log(np.array(PIGMENTS[p][0])) for p in names], 1)  # 3 x P
    cost = np.array([PIGMENTS[p][2] for p in names])
    A = np.vstack([K, math.sqrt(lam) * np.diag(cost)])
    g = np.linspace(0, 1, n)
    lut = np.zeros((n, n, n, len(names)), np.float32)
    for i, r in enumerate(g):
        for j, gg in enumerate(g):
            for k, b in enumerate(g):
                od = -np.log(np.maximum([r, gg, b], 0.03))
                c, _ = nnls(A, np.concatenate([od, np.zeros(len(names))]))
                lut[i, j, k] = c
    return lut, K.astype(np.float32)


def oriented_streaks(theta, rng, sc, length=14.0, fine=1.6, bins=8):
    """Noise smeared along the direction field: the drag marks of a brush."""
    H, W = theta.shape
    n = noise((H, W), fine * sc, rng)
    L = max(3, int(length * sc) | 1)
    base = np.zeros((L, L), np.float32)
    base[L // 2, :] = 1.0
    out = np.zeros((H, W), np.float32)
    wsum = np.zeros((H, W), np.float32)
    for i in range(bins):
        a = i * np.pi / bins
        M = cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), -math.degrees(a), 1.0)
        k = cv2.warpAffine(base, M, (L, L), flags=cv2.INTER_LINEAR)
        k /= k.sum() + 1e-6
        wt = np.maximum(np.cos(2 * (theta - a)), 0) ** 4
        out += cv2.filter2D(n, -1, k, borderType=cv2.BORDER_REFLECT) * wt
        wsum += wt
    out /= wsum + 1e-6
    return (out - out.mean()) / (out.std() + 1e-6)


def watercolour(rgb, seed=0, palette="victorian", return_parts=False, crisp=1.0):
    """Return float32 RGBA (HxWx4, [0,1]) watercolour vignette.

    crisp (0..1) trades the loose, wet look for definition: washes are simplified at full
    resolution, edges wander less, fine tonal detail is carried into the pigment, and the pen
    underdrawing is firmer, in the manner of a Victorian pen-and-wash topographical drawing."""
    rng = np.random.default_rng(seed)
    H, W = rgb.shape[:2]
    sc = W / 1000.0
    names = PALETTES.get(palette, PALETTES["victorian"])
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    def warp(img, amp, scale):
        dx = noise((H, W), scale, rng) * amp
        dy = noise((H, W), scale, rng) * amp
        return cv2.remap(img, xx + dx, yy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    u8 = np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8)
    L0 = lightness(rgb)
    sky = sky_mask(rgb, L0)

    # ---- simplify into washes --------------------------------------------
    if crisp > 0:
        ms = cv2.pyrMeanShiftFiltering(u8, sp=max(4, int(round(5 * sc))), sr=int(22 - 6 * crisp), maxLevel=1)
        ms = cv2.bilateralFilter(ms, 0, 16, 2.5 * sc)
        abst = cv2.medianBlur(ms, 3)
    else:
        small = cv2.resize(u8, (W // 2, H // 2), interpolation=cv2.INTER_AREA)
        ms = cv2.pyrMeanShiftFiltering(small, sp=7, sr=22, maxLevel=1)
        ms = cv2.bilateralFilter(ms, 0, 20, 4)
        ms = cv2.medianBlur(ms, 5)
        abst = cv2.resize(ms, (W, H), interpolation=cv2.INTER_CUBIC)
    absf = abst.astype(np.float32) / 255
    absw = warp(absf, (2.2 - 1.3 * crisp) * sc, 14 * sc)          # hand-laid, wandering edges

    # restrain colour: lighten, compress chroma, warm slightly
    lab = cv2.cvtColor(absw, cv2.COLOR_RGB2Lab)
    lab[..., 0] = 100 - (100 - lab[..., 0]) * 0.84
    chroma = np.sqrt(lab[..., 1] ** 2 + lab[..., 2] ** 2)
    f = 0.92 / (1 + chroma / 75)
    lab[..., 1] *= f
    lab[..., 2] = lab[..., 2] * f + 2.5
    tgt = np.clip(cv2.cvtColor(lab, cv2.COLOR_Lab2RGB), 0, 1)

    # ---- decompose into pigment layers -----------------------------------
    lut, K = _pigment_lut(names)
    n = lut.shape[0]
    coords = (tgt.reshape(-1, 3) * (n - 1)).T
    conc = np.stack([ndi.map_coordinates(lut[..., p], coords, order=1, mode="nearest")
                     .reshape(H, W) for p in range(len(names))], 0)

    # leave paper for highlights; a thin wash graded down the sky
    hl = 1 - smoothstep(0.86, 0.97, blur(L0, 1.5 * sc))
    if sky.max() > 0.5:
        rows = np.flatnonzero(sky.max(1) > 0.05)
        yb = max(rows.max(), 1)
        grade = 1.0 - 0.6 * np.clip(yy / yb, 0, 1) ** 1.3
        skyf = 1 - sky * (1 - 0.8 * grade)
    else:
        skyf = np.ones((H, W), np.float32)
    conc *= (hl * skyf)[None]
    if crisp > 0:
        # carry fine tonal detail (stonework, foliage, mouldings) into the washes
        hp = L0 - blur(L0, 1.6 * sc)
        conc *= (1 + 0.9 * crisp * np.clip(-hp * 7, 0, 1.6) * (1 - sky))[None]

    # ---- the vignette: a ragged wash edge, crisp in places, soft in others -
    vd = irregular_vignette(H, W, rng, margin=0.07, ragged=1.25, power=2.6)
    soft = (1.5 + 30.0 * smoothstep(-0.2, 1.0, noise((H, W), 0.10 * min(H, W), rng))) * sc
    border = np.minimum(np.minimum(yy, H - 1 - yy), np.minimum(xx, W - 1 - xx))
    V = smoothstep(-soft * 0.5, soft * 0.5, vd) * smoothstep(18 * sc, 50 * sc, border)
    conc *= V[None]

    # ---- paper --------------------------------------------------------------
    grain = fbm((H, W), [2.5 * sc, 5 * sc, 11 * sc], [0.4, 0.4, 0.2], rng)
    fine = fbm((H, W), [1.0 * sc, 2.0 * sc], [0.6, 0.4], rng)
    g01 = 1 / (1 + np.exp(-1.6 * grain))

    theta = orientation_field(blur(L0, 2 * sc), ((3 * sc, 14 * sc, 1.0),),
                              bias_angle=0.0, bias_weight=0.08)
    bleed = smoothstep(0.45, 1.0, noise((H, W), 55 * sc, rng))

    # blooms (cauliflowers): a few places where water crept back into a wash
    tot = conc.sum(0)
    bloom = np.zeros((H, W), np.float32)
    cand = np.flatnonzero(((tot > 0.25) & (tot < 1.6) & (V > 0.95)).ravel())
    if len(cand):
        for i in rng.choice(cand, size=min(len(cand), int(rng.integers(3, 7))), replace=False):
            cy, cx = divmod(int(i), W)
            r = rng.uniform(14, 38) * sc
            y0, y1 = max(0, int(cy - 2 * r)), min(H, int(cy + 2 * r))
            x0, x1 = max(0, int(cx - 2 * r)), min(W, int(cx + 2 * r))
            d = np.sqrt((xx[y0:y1, x0:x1] - cx) ** 2 + (yy[y0:y1, x0:x1] - cy) ** 2) / r
            d = d + 0.35 * noise((y1 - y0, x1 - x0), 0.25 * r, rng)
            bloom[y0:y1, x0:x1] = np.maximum(bloom[y0:y1, x0:x1], smoothstep(1.0, 0.8, d))

    # ---- per-pigment wash behaviour --------------------------------------
    out_od = np.zeros((H, W, 3), np.float32)
    for p, name in enumerate(names):
        c = conc[p]
        if c.max() < 0.02:
            continue
        gran = PIGMENTS[name][1]
        c = warp(c, (1.4 - 0.7 * crisp) * sc, 22 * sc)          # misregistered washes
        c = c * (1 + 0.20 * noise((H, W), 50 * sc, rng)
                 + 0.10 * noise((H, W), 16 * sc, rng))          # uneven, puddled wash
        c = c * (1 + 0.13 * oriented_streaks(theta, rng, sc))    # brush drag
        b = bleed * (1 - 0.65 * crisp)
        c = c * (1 - b) + blur(c, (5 - 2 * crisp) * sc) * b      # wet-in-wet, lost edges
        c = c * (1 - 0.35 * bloom)
        hp = c - blur(c, 2.4 * sc)
        wet = 0.8 + 0.6 * smoothstep(-1, 1, noise((H, W), 25 * sc, rng))
        c = c + 1.25 * np.clip(hp, 0, None) * wet * (1 - 0.6 * bleed)  # pooled wet edges
        c = c - 0.5 * np.clip(-hp, 0, None)                      # pigment pulled away
        c = c * (1 + gran * 0.30 * np.clip(-fine, -2.5, 2.5) * smoothstep(0.1, 0.9, c))
        c = np.clip(c, 0, None)
        out_od += c[..., None] * K[:, p][None, None, :]

    # ---- underdrawing in sepia ink, wandering off the washes ---------------
    S = 2
    if crisp > 0:
        pen_src = cv2.bilateralFilter(u8, 0, 22, 2 * sc)
        e = canny_edges(pen_src, int(55 - 15 * crisp), int(120 - 25 * crisp))
        chains = edge_chains(e, min_len=int((18 - 6 * crisp) * sc))
    else:
        e = canny_edges(abst, 45, 110)
        chains = edge_chains(e, min_len=int(18 * sc))
    Vd = smoothstep(-30 * sc, 6 * sc, vd) * smoothstep(12 * sc, 40 * sc, border)
    jx = noise((H, W), 35 * sc, rng) * 1.0 * sc
    jy = noise((H, W), 35 * sc, rng) * 1.0 * sc
    strokes = []
    for ch in chains:
        w = (0.75 - 0.2 * crisp) * sc * sample(Vd, ch) * rng.uniform(0.8, 1.2)
        off = np.stack([sample(jx, ch), sample(jy, ch)], 1)
        strokes.append((ch + off, w))
    segs = Segs()
    segs.add_strokes(strokes, wmin=0.2 * sc, taper=8 * sc)
    dline = segs.render(H, W, S)
    dline *= 0.45 + 0.55 * smoothstep(0.2, 0.65, g01)           # the pen skips the valleys
    sepia = np.array([0.42, 0.30, 0.21], np.float32) * (1 - 0.25 * crisp)

    # ---- composite ----------------------------------------------------------
    paper = np.array(PAGE_PAPER, np.float32) / 255
    gx, gy = grad(blur(grain, 0.8 * sc))
    shade = 1 + 0.014 * np.clip((gx - gy) / (np.std(gx) + 1e-6) * 0.5, -2, 2)
    col = paper[None, None] * shade[..., None]
    col = col * np.exp(-out_od)
    col = col * (1 - (0.60 + 0.2 * crisp) * dline[..., None] * (1 - sepia)[None, None])

    outer = vd + soft * 0.5
    alpha = smoothstep(-20 * sc, 0, outer) * smoothstep(3 * sc, 25 * sc, border)
    alpha = np.maximum(alpha, np.clip(dline * 1.5, 0, 1))
    rgba = np.dstack([np.clip(col, 0, 1), alpha]).astype(np.float32)
    if return_parts:
        return rgba, dict(sky=sky, V=V, conc=conc, names=names)
    return rgba


def save_watercolour(rgba, out, preview=None, quality=80):
    u8 = np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(u8, "RGBA").save(out, "WEBP", quality=quality, method=6)
    if preview:
        paper = np.array(PAGE_PAPER, np.float32) / 255
        a = rgba[..., 3:4]
        c = rgba[..., :3] * a + paper * (1 - a)
        Image.fromarray(np.clip(c * 255 + 0.5, 0, 255).astype(np.uint8)).save(preview)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="style", required=True)

    def common(p):
        p.add_argument("input", help="PNG or JPEG")
        p.add_argument("output", help=".webp to write")
        p.add_argument("--width", type=int, default=1000, help="output width in px (default 1000)")
        p.add_argument("--seed", type=int, default=1, help="random seed (default 1)")
        p.add_argument("--quality", type=int, default=80, help="WebP quality (default 80)")
        p.add_argument("--preview", help="also write a PNG composited on paper #ebe6d8")

    pe = sub.add_parser("engraving", help="line engraving; ink in the alpha channel")
    common(pe)
    pe.add_argument("--density", type=float, default=1.0,
                    help="line density multiplier (default 1.0; >1 = finer, closer lines)")
    pe.add_argument("--no-vignette", action="store_true", help="hatch right to the edges")

    pw = sub.add_parser("watercolour", aliases=["watercolor"], help="watercolour vignette")
    common(pw)
    pw.add_argument("--palette", default="victorian", choices=sorted(PALETTES))
    pw.add_argument("--crisp", type=float, default=1.0,
                    help="0 = loose and wet, 1 = defined pen-and-wash (default 1.0)")
    pe.add_argument("--max-kb", type=int, default=None, help="cap the file size by lowering alpha quality")

    a = ap.parse_args(argv)
    t0 = time.time()
    img = load_image(a.input, a.width)
    if a.style == "engraving":
        cov = engrave(img, seed=a.seed, density=a.density, vignette=not a.no_vignette)
        save_engraving(cov, a.output, a.preview, a.quality, a.max_kb)
    else:
        rgba = watercolour(img, seed=a.seed, palette=a.palette, crisp=a.crisp)
        save_watercolour(rgba, a.output, a.preview, a.quality)
    kb = Path(a.output).stat().st_size / 1024
    print(f"{a.output}: {img.shape[1]}x{img.shape[0]}, {kb:.0f} KB, {time.time() - t0:.1f} s")


if __name__ == "__main__":
    sys.exit(main())
