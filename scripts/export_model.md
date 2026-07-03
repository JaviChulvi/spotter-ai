# Model export (one-time, offline)

The app runs **`yolo26n-pose`** in the browser via ONNX Runtime Web. The model
is a static asset at `public/models/yolo26n-pose.onnx` — git-ignored because it
is regenerable and ~12 MB. There is **no fallback model**; if the file is
missing the UI shows a "model missing" state with this command.

## From scratch (conda)

```bash
conda create -n benchpress -c conda-forge python=3.11 pip -y
conda activate benchpress
pip install ultralytics onnx
yolo export model=yolo26n-pose.pt format=onnx opset=13 imgsz=960
mkdir -p public/models && mv yolo26n-pose.onnx public/models/
```

**Input size is 960, not the default 640.** Phone clips are usually portrait,
which leaves a side-on lifter in a thin horizontal band; exporting at 960
roughly doubles arm/wrist keypoint confidence. `MODEL_INPUT_SIZE` in
`src/lib/config.ts` must match the exported size.

`yolo26n-pose.pt` auto-downloads from the Ultralytics assets release on first
use. You can also export in Colab or via Ultralytics HUB and drop the resulting
`.onnx` into `public/models/`.

## Output layout (validated with ultralytics 8.4.86)

The exported output tensor is **`[1, 300, 57]`** — YOLO26 pose is end-to-end /
NMS-free (top-300 detections, no NMS needed in JS):

```
57 = box(4: xyxy) + score(1) + class(1) + 17 x (x, y, conf)   # keypoints offset 6
```

`src/lib/pose/decode.ts` decodes this layout (and the older 56-wide raw pose
layout as a convenience). It picks the single highest-confidence person.
