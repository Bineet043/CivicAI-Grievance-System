# Use official python image
FROM python:3.9-slim

# Install system dependencies (needed for OpenCV / YOLOv8)
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Create a user to avoid running as root
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:${PATH}"

WORKDIR /app

# Copy requirements and install
COPY --chown=user:user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy the rest of the backend files
COPY --chown=user:user . .

# Expose port 7860 (Hugging Face Spaces runs on port 7860)
EXPOSE 7860

# Run FastAPI app using uvicorn
CMD ["uvicorn", "classify_server:app", "--host", "0.0.0.0", "--port", "7860"]
