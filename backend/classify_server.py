"""
CivicAI Real ML Classification Server
3-Step Pipeline: YOLO (Pothole) → CLIP (Streetlight/Garbage/Water Leak) → Gemini Flash (Fallback)
"""

import os
import io
import json
import traceback
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="CivicAI Classification Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Global Model Variables (loaded once at startup) ─────────────────────────

yolo_model = None
clip_model = None
clip_processor = None

# CLIP prompt-to-category mapping
CLIP_PROMPTS = [
    "a deep hole or pothole in the road surface",
    "a cracked, fractured, or damaged road surface",
    "a pile of garbage, waste, or trash on the ground",
    "an overflowing public garbage bin or trash can",
    "water leaking, spraying, or dripping from a pipe or valve",
    "a flooded street or waterlogged road with deep water",
    "a street drain blocked by debris, leaves, or mud",
    "sewage, dirty water, or wastewater overflowing from a sewer",
    "an open manhole on the street, missing its cover",
    "a broken, dark, or non-functioning streetlight at night",
    "a fallen tree or large tree branch blocking the road or sidewalk",
    "a stray dog, cow, or other animal roaming on the street",
    "construction waste, bricks, concrete debris dumped illegally on the road side",
    "a broken, cracked, or damaged pedestrian footpath or sidewalk",
    "a shop extension, vehicle, stall, or structure blocking the public road or sidewalk",
    "something that is not an urban civic grievance",
]

CLIP_CATEGORY_MAP = {
    "a deep hole or pothole in the road surface": "Pothole",
    "a cracked, fractured, or damaged road surface": "Road Crack / Damaged Road",
    "a pile of garbage, waste, or trash on the ground": "Trash Pile",
    "an overflowing public garbage bin or trash can": "Overflowing Garbage Bin",
    "water leaking, spraying, or dripping from a pipe or valve": "Water Leakage",
    "a flooded street or waterlogged road with deep water": "Waterlogging / Flooded Road",
    "a street drain blocked by debris, leaves, or mud": "Blocked Drain",
    "sewage, dirty water, or wastewater overflowing from a sewer": "Sewage Overflow",
    "an open manhole on the street, missing its cover": "Open Manhole",
    "a broken, dark, or non-functioning streetlight at night": "Streetlight Not Working",
    "a fallen tree or large tree branch blocking the road or sidewalk": "Fallen Tree / Large Branch",
    "a stray dog, cow, or other animal roaming on the street": "Stray Animal",
    "construction waste, bricks, concrete debris dumped illegally on the road side": "Illegal Dumping of Construction Debris",
    "a broken, cracked, or damaged pedestrian footpath or sidewalk": "Damaged Footpath / Sidewalk",
    "a shop extension, vehicle, stall, or structure blocking the public road or sidewalk": "Encroachment / Obstruction on Road",
}

CONFIDENCE_THRESHOLD = 0.60


# ─── Model Loading at Startup ────────────────────────────────────────────────

@app.on_event("startup")
async def load_models():
    global yolo_model, clip_model, clip_processor

    print("=" * 60)
    print("  CivicAI ML Classification Server — Loading Models...")
    print("=" * 60)

    # 1. Load YOLO pothole detection model (public, non-gated)
    try:
        from ultralytics import YOLO
        print("[YOLO] Loading Pothole-Finetuned-YOLOv8 from Hugging Face ...")
        yolo_model = YOLO("https://huggingface.co/Harisanth/Pothole-Finetuned-YOLOv8/resolve/main/best.pt")
        print("[YOLO] ✓ Model loaded successfully.")
    except Exception as e:
        print(f"[YOLO] ✗ Failed to load: {e}")
        traceback.print_exc()

    # 2. Load CLIP model and processor
    try:
        from transformers import CLIPModel, CLIPProcessor
        model_name = "openai/clip-vit-base-patch32"
        print(f"[CLIP] Loading {model_name} ...")
        clip_processor = CLIPProcessor.from_pretrained(model_name)
        clip_model = CLIPModel.from_pretrained(model_name)
        print("[CLIP] ✓ Model loaded successfully.")
    except Exception as e:
        print(f"[CLIP] ✗ Failed to load: {e}")
        traceback.print_exc()

    print("=" * 60)
    print("  All models loaded. Server ready for classification.")
    print("=" * 60)


# ─── Step 1: YOLO Pothole Detection ──────────────────────────────────────────

def run_yolo(image: Image.Image) -> Optional[dict]:
    """Run YOLO pothole detection. Returns result dict if confident, else None."""
    if yolo_model is None:
        print("[YOLO] Model not available, skipping.")
        return None

    try:
        results = yolo_model(image, verbose=False)

        best_conf = 0.0
        for result in results:
            if result.boxes is not None and len(result.boxes) > 0:
                confidences = result.boxes.conf.cpu().numpy()
                max_conf = float(confidences.max())
                if max_conf > best_conf:
                    best_conf = max_conf

        print(f"[YOLO] Best pothole confidence: {best_conf:.4f}")

        if best_conf >= CONFIDENCE_THRESHOLD:
            return {
                "isValid": True,
                "category": "Pothole",
                "confidence": round(best_conf, 4),
                "source": "yolo"
            }
    except Exception as e:
        print(f"[YOLO] Error during inference: {e}")
        traceback.print_exc()

    return None


# ─── Step 2: CLIP Zero-Shot Classification ───────────────────────────────────

def run_clip(image: Image.Image) -> Optional[dict]:
    """Run CLIP zero-shot classification. Returns result dict if confident, else None."""
    if clip_model is None or clip_processor is None:
        print("[CLIP] Model not available, skipping.")
        return None

    try:
        import torch

        inputs = clip_processor(
            text=CLIP_PROMPTS,
            images=image,
            return_tensors="pt",
            padding=True
        )

        with torch.no_grad():
            outputs = clip_model(**inputs)

        logits_per_image = outputs.logits_per_image
        probs = logits_per_image.softmax(dim=1).cpu().numpy()[0]

        # Log all probabilities
        for prompt, prob in zip(CLIP_PROMPTS, probs):
            print(f"[CLIP]   {prompt}: {prob:.4f}")

        top_idx = int(probs.argmax())
        top_prompt = CLIP_PROMPTS[top_idx]
        top_conf = float(probs[top_idx])

        print(f"[CLIP] Top match: \"{top_prompt}\" ({top_conf:.4f})")

        # Check if the top prompt is a valid civic category (not the "not a grievance" prompt)
        if top_prompt in CLIP_CATEGORY_MAP and top_conf >= CONFIDENCE_THRESHOLD:
            return {
                "isValid": True,
                "category": CLIP_CATEGORY_MAP[top_prompt],
                "confidence": round(top_conf, 4),
                "source": "clip"
            }
    except Exception as e:
        print(f"[CLIP] Error during inference: {e}")
        traceback.print_exc()

    return None


# ─── Step 3: Gemini Flash Fallback ───────────────────────────────────────────

def run_gemini(image: Image.Image) -> dict:
    """Gemini Flash fallback for validation and classification."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[GEMINI] No API key found in environment.")
        return {
            "isValid": False,
            "reason": "Gemini API key not configured on server.",
            "source": "gemini"
        }

    try:
        from google import genai

        client = genai.Client(api_key=api_key)

        prompt = (
            "You are a civic grievance validator for an urban municipal platform. "
            "Look at this image carefully. First decide: is this a legitimate urban "
            "civic grievance that a city government should fix? If yes, classify it "
            "into exactly one of these 15 categories:\n"
            "1. Pothole\n"
            "2. Road Crack / Damaged Road\n"
            "3. Trash Pile\n"
            "4. Overflowing Garbage Bin\n"
            "5. Water Leakage\n"
            "6. Waterlogging / Flooded Road\n"
            "7. Blocked Drain\n"
            "8. Sewage Overflow\n"
            "9. Open Manhole\n"
            "10. Streetlight Not Working\n"
            "11. Fallen Tree / Large Branch\n"
            "12. Stray Animal\n"
            "13. Illegal Dumping of Construction Debris\n"
            "14. Damaged Footpath / Sidewalk\n"
            "15. Encroachment / Obstruction on Road\n\n"
            "If no, explain why in one short sentence. "
            "Respond only in JSON: { \"isValid\": true/false, \"category\": \"...\", \"reason\": \"...\" }"
        )

        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[prompt, image],
        )

        response_text = response.text.strip()
        print(f"[GEMINI] Raw response: {response_text}")

        # Clean markdown code fences if present
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            # Remove first and last lines (the fences)
            lines = [l for l in lines if not l.strip().startswith("```")]
            response_text = "\n".join(lines).strip()

        parsed = json.loads(response_text)

        if parsed.get("isValid", False):
            return {
                "isValid": True,
                "category": parsed.get("category", "Other"),
                "confidence": 0.75,
                "source": "gemini"
            }
        else:
            return {
                "isValid": False,
                "reason": parsed.get("reason", "Image was not recognized as a valid civic grievance."),
                "source": "gemini"
            }

    except Exception as e:
        print(f"[GEMINI] Error: {e}")
        traceback.print_exc()
        return {
            "isValid": False,
            "reason": f"Gemini classification failed: {str(e)}",
            "source": "gemini"
        }


# ─── Main Classification Endpoint ────────────────────────────────────────────

@app.post("/classify")
async def classify_image(file: UploadFile = File(...)):
    """
    3-step classification pipeline:
    1. YOLO (pothole detection)
    2. CLIP (streetlight / garbage / water leak)
    3. Gemini Flash (fallback validator + classifier)
    """
    try:
        print("\n" + "=" * 60)
        print(f"[REQUEST] Received image: {file.filename} ({file.content_type})")
        print("=" * 60)

        # Read and open image
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        print(f"[IMAGE] Size: {image.size}, Mode: {image.mode}")

        # Step 1: YOLO
        print("\n--- Step 1: YOLO Pothole Detection ---")
        yolo_result = run_yolo(image)
        if (yolo_result is not None):
            # YOLO is only trained on potholes and can easily misclassify open manholes, drains, or sewage.
            # We run Gemini to verify it isn't one of these visually similar categories before finalizing.
            print("[YOLO Validation] Running Gemini Flash to verify it is indeed a pothole and not an open manhole, sewage, or drain...")
            validation_result = run_gemini(image)
            if validation_result.get("isValid", False):
                gemini_category = validation_result.get("category", "Pothole")
                if gemini_category != "Pothole":
                    print(f"[YOLO Validation] Gemini identified the issue as '{gemini_category}' (not a Pothole). Overriding YOLO.")
                    return JSONResponse(content=validation_result)
            
            print(f"[RESULT] YOLO confirmed: {yolo_result}")
            return JSONResponse(content=yolo_result)

        # Step 2: CLIP
        print("\n--- Step 2: CLIP Zero-Shot Classification ---")
        clip_result = run_clip(image)
        if clip_result is not None:
            print(f"[RESULT] CLIP classified: {clip_result}")
            return JSONResponse(content=clip_result)

        # Step 3: Gemini Flash Fallback
        print("\n--- Step 3: Gemini Flash Fallback ---")
        gemini_result = run_gemini(image)
        print(f"[RESULT] Gemini result: {gemini_result}")
        return JSONResponse(content=gemini_result)

    except Exception as e:
        print(f"[ERROR] Classification failed: {e}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "isValid": False,
                "reason": f"Server error during classification: {str(e)}",
                "source": "error"
            }
        )


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "yolo_loaded": yolo_model is not None,
        "clip_loaded": clip_model is not None and clip_processor is not None,
    }
