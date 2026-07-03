#!/usr/bin/env python
"""Offline pose-dump harness for validating the analysis engine on a real clip.

Runs the SAME model the browser uses (yolo26n-pose.pt) over a video and writes
per-frame COCO-17 keypoints (in source-video pixels) to JSON, mirroring the
browser worker: letterbox -> infer @ imgsz -> pick the LARGEST detected person
-> keypoints in original-image coordinates. Also saves sparse annotated frames
for visual QA.

Usage:
  python scripts/dump_pose.py IMG_5057.MOV --out scratchpad/pose.json --stride 2
"""
import argparse
import json
import os

import cv2
from ultralytics import YOLO


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--model", default="yolo26n-pose.pt")
    ap.add_argument("--out", required=True)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--stride", type=int, default=2, help="process every Nth frame")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--qa-dir", default=None, help="dir for sparse annotated frames")
    ap.add_argument("--qa-every-s", type=float, default=1.0)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if args.qa_dir:
        os.makedirs(args.qa_dir, exist_ok=True)

    model = YOLO(args.model)
    frames = []
    idx = -1
    last_qa_t = -1e9
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        idx += 1
        if idx % args.stride != 0:
            continue
        t = idx / fps
        res = model(frame, imgsz=args.imgsz, conf=args.conf, verbose=False)[0]

        kp = None
        persons = []  # every above-conf detection, for replaying through the tracker
        if res.keypoints is not None and res.boxes is not None and len(res.boxes) > 0:
            xyxy = res.boxes.xyxy.cpu().numpy()  # [n,4]
            scores = res.boxes.conf.cpu().numpy()  # [n]
            data = res.keypoints.data.cpu().numpy()  # [n,17,3]
            for bi in range(len(xyxy)):
                persons.append({
                    "box": [float(v) for v in xyxy[bi]],  # xyxy
                    "score": float(scores[bi]),
                    "kp": [[float(x), float(y), float(c)] for x, y, c in data[bi]],
                })
            areas = (xyxy[:, 2] - xyxy[:, 0]) * (xyxy[:, 3] - xyxy[:, 1])
            best = int(areas.argmax())  # largest person == the lifter (nearest camera)
            kp = persons[best]["kp"]

        frames.append({"t": round(t, 4), "kp": kp, "persons": persons})

        if args.qa_dir and t - last_qa_t >= args.qa_every_s:
            last_qa_t = t
            annotated = res.plot()
            cv2.imwrite(os.path.join(args.qa_dir, f"f_{t:07.3f}.jpg"), annotated)

        if idx % 200 == 0:
            print(f"  frame {idx}/{total}  t={t:6.2f}s  detected={kp is not None}", flush=True)

    cap.release()
    out = {
        "video": os.path.basename(args.video),
        "fps": fps,
        "width": width,
        "height": height,
        "stride": args.stride,
        "count": len(frames),
        "frames": frames,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f)
    detected = sum(1 for fr in frames if fr["kp"] is not None)
    print(f"wrote {args.out}: {len(frames)} frames ({detected} with a person), "
          f"src {width}x{height} @ {fps:.2f}fps")


if __name__ == "__main__":
    main()
