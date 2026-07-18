#!/usr/bin/env python3
"""
同步交通部民航局（CAA）無人機空域圖資。

資料來源：民航局無人機 GIS 圖台背後的 ArcGIS REST FeatureServer
  入口：https://drone.caa.gov.tw/
  圖台：https://dronegis.caa.gov.tw/portal/apps/webappviewer/index.html?id=807bd21438ba4208b4a7e28569fe41aa

本腳本會抓取各圖層、輸出：
  public/data/<slug>.geojson   （未壓縮 GeoJSON，供 Leaflet 直接讀取）
  public/data/<slug>.kml        （KML，供 Google Earth / My Maps / DJI 等使用）
  public/data/manifest.json     （更新時間、各圖層筆數）

零外部依賴，只需要 Python 3.10+。
免責：本腳本整理的是公開可查詢的 ArcGIS REST 端點，非官方文件化 API；
      實際飛行仍應以主管機關最新公告為準。
"""
from __future__ import annotations

import json
import math
import ssl
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from xml.sax.saxutils import escape

BASE_URL = "https://dronegis.caa.gov.tw/server/rest/services"
USER_AGENT = "reason-drone-airspace/1.0 (+https://github.com/)"
SSL_CONTEXT = ssl._create_unverified_context()
TZ_TAIPEI = timezone(timedelta(hours=8))

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "public" / "data"

# 圖層定義：slug / 顯示名稱 / ArcGIS 服務路徑 / 地圖上色
LAYERS = [
    {"slug": "uav_restricted_airspace", "title": "禁限航區（主空域）",
     "service": "Hosted/UAV_fs/FeatureServer/3", "color": "#e53935"},
    {"slug": "temporary_area", "title": "臨時空域",
     "service": "Hosted/Temporary_Area/FeatureServer/19", "color": "#fb8c00"},
    {"slug": "national_park", "title": "國家公園",
     "service": "Hosted/National_Park_fs/FeatureServer/0", "color": "#43a047"},
    {"slug": "commercial_port", "title": "商港區",
     "service": "Hosted/Commercial_Port_fs/FeatureServer/4", "color": "#1e88e5"},
    {"slug": "county", "title": "行政區界",
     "service": "Hosted/County_fs/FeatureServer/0", "color": "#8e24aa"},
]


def request_json(url: str, params: dict, retries: int = 4) -> dict:
    query = urlencode(params)
    req = Request(f"{url}?{query}", headers={"User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with urlopen(req, timeout=120, context=SSL_CONTEXT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as exc:
            last_err = exc
            if attempt == retries:
                break
            time.sleep(attempt * 1.5)
    raise RuntimeError(f"請求失敗：{url} ({last_err})")


def fetch_layer(layer: dict, page_size: int = 1000, sleep: float = 0.2) -> dict:
    query_url = f"{BASE_URL}/{layer['service']}/query"
    count = int(request_json(query_url, {
        "where": "1=1", "returnCountOnly": "true", "f": "pjson",
    })["count"])

    features: list[dict] = []
    for offset in range(0, count, page_size):
        page = request_json(query_url, {
            "where": "1=1",
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "orderByFields": "objectid",
            "resultOffset": offset,
            "resultRecordCount": page_size,
            "f": "geojson",
        })
        if page.get("type") != "FeatureCollection":
            raise RuntimeError(f"非預期回應：{query_url}")
        features.extend(page.get("features", []))
        if sleep:
            time.sleep(sleep)

    return {
        "type": "FeatureCollection",
        "name": layer["slug"],
        "metadata": {
            "title": layer["title"],
            "color": layer["color"],
            "service": layer["service"],
            "reported_count": count,
            "feature_count": len(features),
        },
        "features": features,
    }


# ---------- GeoJSON → KML ----------

def _coords_to_kml(ring: list) -> str:
    return " ".join(f"{pt[0]},{pt[1]},0" for pt in ring)


def _polygon_kml(coords: list) -> str:
    parts = []
    for i, ring in enumerate(coords):
        tag = "outerBoundaryIs" if i == 0 else "innerBoundaryIs"
        parts.append(
            f"<{tag}><LinearRing><coordinates>{_coords_to_kml(ring)}"
            f"</coordinates></LinearRing></{tag}>"
        )
    return f"<Polygon>{''.join(parts)}</Polygon>"


def _geometry_kml(geom: dict) -> str:
    if not geom:
        return ""
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Polygon":
        return _polygon_kml(coords)
    if gtype == "MultiPolygon":
        polys = "".join(_polygon_kml(poly) for poly in coords)
        return f"<MultiGeometry>{polys}</MultiGeometry>"
    if gtype == "Point":
        return f"<Point><coordinates>{coords[0]},{coords[1]},0</coordinates></Point>"
    if gtype == "LineString":
        return f"<LineString><coordinates>{_coords_to_kml(coords)}</coordinates></LineString>"
    return ""


def geojson_to_kml(fc: dict, name: str, color_hex: str) -> str:
    # KML 顏色為 aabbggrr；把 #rrggbb 轉成半透明填色
    rgb = color_hex.lstrip("#")
    kml_color = f"88{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}"      # 半透明填色
    line_color = f"ff{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}"     # 不透明邊線
    placemarks = []
    for feat in fc.get("features", []):
        props = feat.get("properties", {}) or {}
        title = (props.get("空域名稱") or props.get("name")
                 or props.get("NAME") or str(feat.get("id", "")))
        rows = "".join(
            f"<tr><th>{escape(str(k))}</th><td>{escape(str(v))}</td></tr>"
            for k, v in props.items() if v not in (None, "")
        )
        desc = f"<![CDATA[<table>{rows}</table>]]>"
        geom_kml = _geometry_kml(feat.get("geometry"))
        if not geom_kml:
            continue
        placemarks.append(
            f"<Placemark><name>{escape(str(title))}</name>"
            f"<description>{desc}</description>"
            f"<styleUrl>#s</styleUrl>{geom_kml}</Placemark>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        f"<name>{escape(name)}</name>"
        f'<Style id="s"><LineStyle><color>{line_color}</color><width>2</width></LineStyle>'
        f"<PolyStyle><color>{kml_color}</color></PolyStyle></Style>"
        + "".join(placemarks)
        + "</Document></kml>"
    )


def _perp_dist(p, a, b) -> float:
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def _dp(points, tol):
    """Douglas–Peucker（疊代版，避免遞迴深度問題）。"""
    n = len(points)
    if n < 3:
        return list(points)
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        s, e = stack.pop()
        maxd, idx = 0.0, -1
        a, b = points[s], points[e]
        for i in range(s + 1, e):
            d = _perp_dist(points[i], a, b)
            if d > maxd:
                maxd, idx = d, i
        if idx != -1 and maxd > tol:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [points[i] for i in range(n) if keep[i]]


def _round_ring(ring, nd):
    return [[round(pt[0], nd), round(pt[1], nd)] for pt in ring]


def _simplify_ring(ring, tol, nd):
    r = _round_ring(ring, nd)
    if len(r) <= 4:
        return r
    s = _dp(r, tol)
    if len(s) < 4:  # 過度簡化 → 保留（略）粗化版
        s = r[:: max(1, len(r) // 8)]
        if s[0] != s[-1]:
            s.append(s[0])
    if s[0] != s[-1]:
        s.append(s[0])
    return s


def optimize_geometry(geom, tol=0.00012, nd=6):
    """簡化 + 降精度，大幅減少頂點與檔案大小（對無人機參考圖資影響可忽略）。"""
    if not geom:
        return geom, 0, 0
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    before = after = 0
    if gtype == "Polygon":
        new = []
        for ring in coords:
            before += len(ring)
            sr = _simplify_ring(ring, tol, nd)
            after += len(sr)
            new.append(sr)
        return {"type": "Polygon", "coordinates": new}, before, after
    if gtype == "MultiPolygon":
        new = []
        for poly in coords:
            np = []
            for ring in poly:
                before += len(ring)
                sr = _simplify_ring(ring, tol, nd)
                after += len(sr)
                np.append(sr)
            new.append(np)
        return {"type": "MultiPolygon", "coordinates": new}, before, after
    return geom, 0, 0


def optimize_fc(fc: dict) -> dict:
    tot_b = tot_a = 0
    for f in fc.get("features", []):
        g, b, a = optimize_geometry(f.get("geometry"))
        f["geometry"] = g
        tot_b += b
        tot_a += a
    if tot_b:
        pct = 100 * (1 - tot_a / tot_b)
        print(f"  · 幾何簡化：頂點 {tot_b} → {tot_a}（減少 {pct:.0f}%）", flush=True)
    return fc


def build_diag(fc: dict) -> dict:
    """輸出診斷資訊：欄位名稱、可能的類別欄位與其值分佈、樣本、座標格式。"""
    feats = fc.get("features", [])
    keys = set()
    for f in feats[:300]:
        keys.update((f.get("properties") or {}).keys())
    candidates = {}
    for field in ["空域類別名稱", "限制區", "類別", "空域分類", "空域類別",
                  "空域名稱", "type", "category", "Type", "CATEGORY", "KIND", "kind"]:
        vc = {}
        for f in feats:
            v = (f.get("properties") or {}).get(field)
            if v is not None and str(v).strip() != "":
                vc[str(v)] = vc.get(str(v), 0) + 1
        if vc:
            top = dict(sorted(vc.items(), key=lambda x: -x[1])[:25])
            candidates[field] = {"distinct": len(vc), "top": top}
    sample = feats[0] if feats else {}
    geom = sample.get("geometry") or {}
    c = geom.get("coordinates")
    first_coord = None
    try:
        while isinstance(c, list) and c and isinstance(c[0], list):
            c = c[0]
        first_coord = c
    except Exception:
        pass
    return {
        "feature_count": len(feats),
        "property_keys": sorted(keys),
        "category_field_candidates": candidates,
        "sample_properties": sample.get("properties"),
        "sample_geometry_type": geom.get("type"),
        "sample_first_coordinate": first_coord,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="同步民航局無人機空域圖資")
    ap.add_argument("--output-dir", default=str(OUTPUT_DIR))
    ap.add_argument("--layer", help="只同步單一圖層 slug")
    ap.add_argument("--no-kml", action="store_true", help="不輸出 KML")
    args = ap.parse_args()

    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)

    layers = LAYERS
    if args.layer:
        layers = [l for l in LAYERS if l["slug"] == args.layer]
        if not layers:
            raise SystemExit(f"未知圖層：{args.layer}")

    manifest_layers = []
    for layer in layers:
        print(f"→ 抓取 {layer['slug']} ({layer['title']}) ...", flush=True)
        fc = fetch_layer(layer)
        fc = optimize_fc(fc)   # 簡化幾何 + 降精度，讓數千筆能順利繪製
        n = fc["metadata"]["feature_count"]

        (out / f"{layer['slug']}.geojson").write_text(
            json.dumps(fc, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        if not args.no_kml:
            (out / f"{layer['slug']}.kml").write_text(
                geojson_to_kml(fc, layer["title"], layer["color"]),
                encoding="utf-8",
            )
        if layer["slug"] == "uav_restricted_airspace":
            (out / "_diag.json").write_text(
                json.dumps(build_diag(fc), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print("  ✔ 已輸出 _diag.json 診斷檔", flush=True)
        manifest_layers.append({
            "slug": layer["slug"], "title": layer["title"],
            "color": layer["color"], "feature_count": n,
            "geojson": f"data/{layer['slug']}.geojson",
            "kml": f"data/{layer['slug']}.kml",
        })
        print(f"  ✔ {n} 筆", flush=True)

    now_utc = datetime.now(timezone.utc)
    manifest = {
        "dataset": "reason-drone-airspace",
        "source": "交通部民用航空局 (dronegis.caa.gov.tw ArcGIS REST)",
        "generated_at_utc": now_utc.isoformat(),
        "generated_at_taipei": now_utc.astimezone(TZ_TAIPEI).strftime("%Y-%m-%d %H:%M"),
        "layer_count": len(manifest_layers),
        "layers": manifest_layers,
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"完成，共 {len(manifest_layers)} 個圖層，輸出於 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
