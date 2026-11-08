# Bundled files for related search

These files ship inside the extension so that nothing is downloaded while it runs. Only `meaning-worker.js` loads them.

- `vendor/transformers/`: Transformers.js 3.7.5 from npm (`@huggingface/transformers`), Apache-2.0 license, included here.
- `models/all-MiniLM-L6-v2/`: Xenova/all-MiniLM-L6-v2 from Hugging Face, commit `751bff37182d3f1213fa05d7196b954e230abad9`, using the small "quantized" model file. It's a converted copy of sentence-transformers/all-MiniLM-L6-v2. Both are Apache-2.0, and a copy of that license is included.

These files keep their own licenses. Sift's MIT license in `LICENSE` covers only Sift's own code.

SHA-256 checksums, in case you want to check that they're unchanged:

```
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  vendor/transformers/LICENSE
08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9  vendor/transformers/ort-wasm-simd-threaded.jsep.mjs
c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39  vendor/transformers/ort-wasm-simd-threaded.jsep.wasm
770f4cfc9857958f8db9c783b406b1c7f3beb3ce0c9b72776ca1e973dae9e145  vendor/transformers/transformers.min.js
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  models/all-MiniLM-L6-v2/LICENSE
7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7  models/all-MiniLM-L6-v2/config.json
da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0  models/all-MiniLM-L6-v2/tokenizer.json
9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3  models/all-MiniLM-L6-v2/tokenizer_config.json
afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1  models/all-MiniLM-L6-v2/onnx/model_quantized.onnx
```
