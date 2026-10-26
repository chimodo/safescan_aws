# QR sticker-edge experiment instructions

## Objective

Run an offline, reproducible computer-vision experiment on the two labeled example images to assess whether a white QR sticker on a white/neutral surface can be distinguished by its outer edge or subtle contact shadow. Compare masking, thresholding, edge detection, and contour-based approaches. Save intermediate visualizations so a person can inspect what each step detects.

This is a small exploratory experiment, not a trained or validated detector. Do not infer reliable accuracy from one positive and one negative image.

## Inputs

- Positive (sticker): `examples/See_sticker-corners.jpg.jpeg`
- Negative (no sticker): `examples/Not_sticker.jpg.jpeg`

These are gallery screenshots, not clean camera originals: they include viewer controls, handwritten annotations, and thumbnails. Preserve the originals. Do not treat handwriting, arrows, UI, or thumbnail content as image evidence. Work on a cropped QR-and-nearby-surface region, and record the crop coordinates used for each image.

## Constraints

- Do not modify the app, production detector, dependencies, or either input image.
- Keep all work local and offline.
- Use classic computer vision only (e.g. OpenCV); do not train a model or send images to a service.
- Do not silently discard an image or a failed processing step. Report failures and why they occurred.
- Keep the QR masking separate from the sticker quiet zone and outer sticker boundary. The QR modules should not dominate contour results, but masking must not erase the possible sticker edge/shadow.
- Do not claim a sticker is present from a contour alone. The desired result is evidence and a recommendation about which methods merit further testing.

## Procedure

1. **Inspect inputs and establish ROIs**
   - Report each image's dimensions and color format.
   - Crop a region containing the entire QR, its white margin, the suspected sticker boundary, and nearby surface. Avoid app/gallery overlays and annotations as far as possible.
   - Save the crops and annotate the crop rectangles on copies of the original.
   - If any annotation overlaps the QR/border evidence, explicitly identify the affected area and avoid using it to support a conclusion.

2. **Find and rectify the QR**
   - Try OpenCV `QRCodeDetector.detect` (or `detectAndDecode` as a fallback) to obtain the QR quadrilateral; decoding the payload is not required and the payload must not be printed or retained.
   - If detection fails or the screenshot has perspective/rotation issues, allow manually specified four-corner points for the experiment. Record those points and distinguish manual from automatic localization.
   - Order the four corners consistently and perspective-warp each ROI to a square. Keep enough outer surface around the QR to inspect the expected sticker footprint.
   - Save an image showing the detected/selected corners and rectified view.

3. **Build explicit, inspectable masks**
   - Create and save separate masks for:
     1. QR printed area (excluded from sticker-edge analysis);
     2. QR quiet zone / white margin (kept separate; test including and excluding it);
     3. surrounding candidate sticker-edge band;
     4. farther local background/reference region.
   - Use normalized coordinates tied to the rectified QR size; show mask overlays on the rectified image.
   - Because the detector corners may bound the QR modules rather than the physical sticker, do not assume they identify the sticker edge. Include a small parameter sweep over plausible outer-band widths and document the values. Ensure the candidate outer boundary remains in the evaluated region.

4. **Compare classical image-processing methods**
   Run each method on the rectified ROI and evaluate evidence only outside the QR printed-area mask:
   - Grayscale and brightness/contrast normalization, including a local method such as CLAHE. Keep the unnormalized baseline.
   - Global thresholding at several documented thresholds and adaptive thresholding (Gaussian and mean variants). Avoid selecting a threshold just to force the desired labels.
   - Canny edge detection at a small documented range of threshold pairs; optionally compare Sobel gradient magnitude.
   - Contour detection on the threshold and edge maps. Filter candidates by closure, area, aspect ratio, rectangularity/convexity, and alignment/scale relative to the rectified QR. Show both retained and rejected contours and explain filters.
   - Inspect local intensity/gradient profiles across each candidate outer edge. Measure corner patches and edge strips on all four sides. Test the proposed two-adjacent-dark/two-adjacent-light pattern without assuming a fixed camera orientation; report the pattern after accounting for rotations/reflections and document the normalization.
   - Compare the candidate boundary signal with the farther local background so broad illumination gradients are not mistaken for a sticker shadow.

5. **Run controlled parameter comparisons**
   - Apply the same parameter sets and scoring rules to both labeled images. A method may use the known labels to compare its outputs after processing, but must not tune parameters separately per image.
   - Produce a compact table per method/image: whether a plausible QR-aligned outer boundary was found, boundary coverage/continuity, candidate dimensions, edge/contrast strength, corner-pattern measurements, and any failure or ambiguity.
   - Show sensitivity to the documented threshold/band-width sweep. Do not report an accuracy percentage or use these two samples to claim generalization.
   - If an image's screenshot annotations make a fair comparison impossible, state that and recommend acquiring clean originals.

## Required outputs

Save results beneath `examples/analysis-results/` without overwriting the inputs:

- A reproducible Python script or notebook containing the analysis and parameter values.
- For **each** input, intermediate PNGs for:
  - source crop with crop bounds;
  - rectified QR view and detected/manual corners;
  - mask overlay (QR, quiet zone, candidate edge band, local background);
  - grayscale/normalized view;
  - representative global and adaptive threshold outputs;
  - Canny and gradient-magnitude outputs;
  - contour overlay, including all candidate and retained contours;
  - edge/corner intensity or gradient measurements visualized on the image.
- A short results summary giving observations, limitations, and a recommendation for the next experiment. Include which features appear to separate these examples, which are ambiguous, and which parameter choices are sensitive.

Ensure saved PNGs are readable at full size and have clear filenames identifying input and processing stage. Keep any plots/overlays legible and do not hide failures.

## Stop condition

Finish after producing the local experiment artifacts and summary. Do not implement or propose unreviewed production changes; return the artifact paths and the strongest evidence/limitations for discussion.
