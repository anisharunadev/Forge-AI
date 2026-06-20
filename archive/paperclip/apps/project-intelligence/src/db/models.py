import uuid
from typing import Any, Dict
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship
from pgvector.sqlalchemy import Vector

Base = declarative_base()

def generate_uuid():
    return str(uuid.uuid4())

def utc_now():
    return datetime.now(timezone.utc)

class GraphNode(Base):
    """
    Represents a generic node in the Project Intelligence graphs
    (Knowledge Graph, Architecture Graph, Dependency Graph).
    """
    __tablename__ = "pi_nodes"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    tenant_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False, index=True)
    
    # E.g., 'repository', 'service', 'database', 'package', 'concept', 'ticket'
    node_type = Column(String, nullable=False, index=True)
    
    name = Column(String, nullable=False)
    
    # Store arbitrary structured data extracted from parsing
    node_metadata = Column(JSONB, default=dict)
    
    # Embedding for semantic search (pgvector)
    # Dimension is 1536 for OpenAI embeddings, or adjust for Voyage AI (e.g., 1024)
    embedding = Column(Vector(1536), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

class GraphEdge(Base):
    """
    Represents a relationship between two nodes in the Project Intelligence graphs.
    """
    __tablename__ = "pi_edges"

    id = Column(UUID(as_uuid=False), primary_key=True, default=generate_uuid)
    tenant_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False, index=True)
    
    source_id = Column(UUID(as_uuid=False), ForeignKey("pi_nodes.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(UUID(as_uuid=False), ForeignKey("pi_nodes.id", ondelete="CASCADE"), nullable=False)
    
    # E.g., 'depends_on', 'implements', 'documents', 'contains'
    relationship_type = Column(String, nullable=False, index=True)
    
    edge_metadata = Column(JSONB, default=dict)
    
    created_at = Column(DateTime(timezone=True), default=utc_now)

    # Relationships for ORM
    source_node = relationship("GraphNode", foreign_keys=[source_id])
    target_node = relationship("GraphNode", foreign_keys=[target_id])
