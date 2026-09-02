# Kokoro TTS service

This focused HTTP service runs the FP16 Kokoro-82M ONNX model for the
extension's chat Read buttons. Inference requires CUDA so a deployment cannot
silently fall back to CPU.

The service exposes `GET /health`, `GET /voices`, and `POST /tts/speak`.
Speech requests contain a bounded text chunk in `script` and an optional
`voice_id`. Successful synthesis responds directly with `audio/wav` bytes and
creates no output files. Inference runs in a worker so health and cancellation
requests remain responsive while Kokoro is generating audio.

Run `npm ci` and `npm start` for local development. The included user service
unit targets the VM deployment at `/home/riley/kokoro-tts-api` on port 8016.
Downloaded model files remain in `/home/riley/.cache/kokoro-js` across package
installs. The unit expects the cuDNN 9 libraries at
`/home/riley/.local/lib/cudnn`.
