"""Application entry point."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401 — register SQLAlchemy models before create_all.
from .api import router
from .database import Base, SessionLocal, engine
from .demo_data import seed_demo_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as session:
        seed_demo_data(session)
    yield


app = FastAPI(
    title="Jawny Ślad API",
    description="Read-only API for exploring public procurement relationships.",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [
    origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/", tags=["system"])
def root() -> dict[str, str]:
    return {"name": "Jawny Ślad API", "docs": "/docs", "health": "/api/health"}
