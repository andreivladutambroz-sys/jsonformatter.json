# clean base image containing only comfyui, comfy-cli and comfyui-manager
FROM runpod/worker-comfyui:5.5.1-base

# install custom nodes into comfyui (first node with --mode remote to fetch updated cache)
# No registry-verified custom nodes to install
# Unknown registry nodes:
# - CheckpointLoaderSimple: no aux_id (GitHub repo) provided in workflow metadata; could not resolve and was skipped

# download models into comfyui
RUN comfy model download --url https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors --relative-path models/checkpoints --filename flux1-dev-fp8.safetensors
RUN comfy model download --url https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors --relative-path models/loras --filename lora.safetensors

# copy all input data (like images or videos) into comfyui (uncomment and adjust if needed)
# COPY input/ /comfyui/input/
