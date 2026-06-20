from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Forge AI - Project Intelligence API",
    description="Ingests repositories and generates Knowledge, Architecture, and Dependency graphs.",
    version="0.1.0"
)

class IngestionRequest(BaseModel):
    tenant_id: str
    project_id: str
    repository_urls: List[str]

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "project-intelligence"}

@app.post("/api/v1/ingest")
async def trigger_ingestion(request: IngestionRequest, background_tasks: BackgroundTasks):
    """
    Trigger background ingestion for the specified repositories.
    """
    logger.info(f"Triggering ingestion for tenant {request.tenant_id}, project {request.project_id}")
    
    # We use a background task to not block the API response
    background_tasks.add_task(
        process_repositories,
        request.tenant_id,
        request.project_id,
        request.repository_urls
    )
    
    return {
        "status": "accepted",
        "message": f"Ingestion started for {len(request.repository_urls)} repositories."
    }

async def process_repositories(tenant_id: str, project_id: str, repo_urls: List[str]):
    """
    Background worker that runs the LangGraph ingestion pipeline.
    """
    logger.info(f"[Worker] Starting processing for {tenant_id}/{project_id}")
    
    for url in repo_urls:
        logger.info(f"[Worker] Fetching repository: {url}")
        # TODO: Implement secure MCP read-only extraction
        
        logger.info(f"[Worker] Generating Dependency Graph for {url}")
        # TODO: Parse package.json / requirements.txt
        
        logger.info(f"[Worker] Generating Architecture Graph for {url}")
        # TODO: Use LiteLLM to analyze structure
        
        logger.info(f"[Worker] Generating Knowledge Graph for {url}")
        # TODO: Use LiteLLM to map concepts
    
    logger.info(f"[Worker] Completed processing for {tenant_id}/{project_id}")
