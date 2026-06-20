import logging
from typing import Dict, Any, List, TypedDict, Annotated
import operator
from langgraph.graph import StateGraph, START, END

logger = logging.getLogger(__name__)

# 1. Define the State for our graph ingestion pipeline
class IngestionState(TypedDict):
    tenant_id: str
    project_id: str
    repo_url: str
    files_fetched: List[Dict[str, Any]]
    extracted_nodes: Annotated[List[Dict[str, Any]], operator.add]
    extracted_edges: Annotated[List[Dict[str, Any]], operator.add]
    errors: Annotated[List[str], operator.add]

# 2. Define the Nodes

def fetch_repository_structure(state: IngestionState) -> Dict:
    """
    Simulates using the GitHubCrawler to fetch the repo's virtual structure.
    """
    logger.info(f"Node [Fetch Structure]: {state['repo_url']}")
    # In a real implementation, call GitHubCrawler here
    mock_files = [
        {"path": "package.json", "content": '{"dependencies": {"react": "18.0.0"}}'},
        {"path": "docker-compose.yml", "content": "services:\n  db:\n    image: postgres"},
        {"path": "README.md", "content": "# Example Service"}
    ]
    return {"files_fetched": mock_files}

def extract_dependencies(state: IngestionState) -> Dict:
    """
    Parses package files to create deterministic dependency nodes and edges.
    """
    logger.info(f"Node [Extract Dependencies]: {state['repo_url']}")
    nodes = []
    edges = []
    
    for file in state.get("files_fetched", []):
        if file["path"] == "package.json":
            # Extract deterministic dependencies
            nodes.append({
                "type": "package",
                "name": "react",
                "metadata": {"version": "18.0.0"}
            })
            edges.append({
                "source_name": state["repo_url"],
                "target_name": "react",
                "relationship": "depends_on"
            })
            
    return {"extracted_nodes": nodes, "extracted_edges": edges}

def extract_architecture(state: IngestionState) -> Dict:
    """
    Uses LiteLLM to analyze infrastructure files and code structure.
    """
    logger.info(f"Node [Extract Architecture]: {state['repo_url']}")
    nodes = []
    edges = []
    
    for file in state.get("files_fetched", []):
        if file["path"] == "docker-compose.yml":
            # Extract infrastructure components
            nodes.append({
                "type": "database",
                "name": "postgres",
                "metadata": {"source": "docker-compose.yml"}
            })
            edges.append({
                "source_name": state["repo_url"],
                "target_name": "postgres",
                "relationship": "uses_database"
            })
            
    return {"extracted_nodes": nodes, "extracted_edges": edges}

def store_to_db(state: IngestionState) -> Dict:
    """
    Takes the aggregated nodes and edges and saves them to PostgreSQL (pgvector).
    """
    logger.info(f"Node [Store to DB]: Saving {len(state.get('extracted_nodes', []))} nodes and {len(state.get('extracted_edges', []))} edges.")
    # Here we would initialize the SQLAlchemy session and insert into GraphNode / GraphEdge
    return {}

# 3. Construct the LangGraph

def build_ingestion_graph() -> StateGraph:
    workflow = StateGraph(IngestionState)
    
    # Add nodes
    workflow.add_node("fetch_structure", fetch_repository_structure)
    workflow.add_node("extract_deps", extract_dependencies)
    workflow.add_node("extract_arch", extract_architecture)
    workflow.add_node("store_db", store_to_db)
    
    # Define edges
    workflow.add_edge(START, "fetch_structure")
    
    # Run extraction in parallel
    workflow.add_edge("fetch_structure", "extract_deps")
    workflow.add_edge("fetch_structure", "extract_arch")
    
    # Wait for extractions to finish then store
    workflow.add_edge("extract_deps", "store_db")
    workflow.add_edge("extract_arch", "store_db")
    
    workflow.add_edge("store_db", END)
    
    return workflow.compile()

# Expose compiled graph
ingestion_pipeline = build_ingestion_graph()
