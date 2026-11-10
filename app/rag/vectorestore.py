import os
import time
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from app.core.config import get_settings

load_dotenv()
settings = get_settings()

_embeddings = None
_vectorstore = None

EMBEDDING_DIMENSIONS = {
    "sentence-transformers/all-minilm-l6-v2": 384,
    "all-minilm-l6-v2": 384,
    "gemini-embedding-001": 3072,
    "text-embedding-004": 768,
}

def get_embedding_dimension(model_name: str | None = None) -> int:
    name = (
        model_name
        or getattr(settings, "embedding_model", None)
        or os.getenv("HUGGINGFACE_EMBEDDING_MODEL")
        or "sentence-transformers/all-MiniLM-L6-v2"
    ).strip()

    if not name:
        raise RuntimeError("Embedding model is not configured")

    normalized = name.lower()

    if normalized in EMBEDDING_DIMENSIONS:
        return EMBEDDING_DIMENSIONS[normalized]

    if "all-minilm" in normalized:
        return 384
    if "gemini-embedding-001" in normalized:
        return 3072
    if "text-embedding-004" in normalized:
        return 768

    raise ValueError(
        f"Unsupported embedding model '{name}' for Pinecone. "
        "Add the matching dimension to EMBEDDING_DIMENSIONS."
    )

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        model_name = getattr(settings, "embedding_model", None) or os.getenv(
            "HUGGINGFACE_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
        )

        if "gemini" in model_name.lower() or "text-embedding" in model_name.lower():
            google_key = (
                getattr(settings, "gemini_api_key", None)
                or os.getenv("GEMINI_API_KEY")
                or os.getenv("GOOGLE_API_KEY")
            )
            if not google_key:
                raise RuntimeError("GEMINI_API_KEY is missing")
            _embeddings = GoogleGenerativeAIEmbeddings(
                model=model_name,
                google_api_key=google_key,
            )
        else:
            _embeddings = HuggingFaceEmbeddings(
                model_name=model_name
            )

    return _embeddings

def ensure_index():
    if not settings.pinecone_api_key:
        raise RuntimeError("PINECONE_API_KEY is missing")

    desired_dimension = get_embedding_dimension()
    pc = Pinecone(api_key=settings.pinecone_api_key)
    names = [x["name"] for x in pc.list_indexes()]

    if settings.pinecone_index_name in names:
        index_info = pc.describe_index(settings.pinecone_index_name)
        current_dimension = getattr(index_info, "dimension", None)
        if current_dimension is None and isinstance(index_info, dict):
            current_dimension = index_info.get("dimension")

        if current_dimension is not None and current_dimension != desired_dimension:
            pc.delete_index(name=settings.pinecone_index_name)
            while settings.pinecone_index_name in [x["name"] for x in pc.list_indexes()]:
                time.sleep(1)

    if settings.pinecone_index_name not in [x["name"] for x in pc.list_indexes()]:
        pc.create_index(
            name=settings.pinecone_index_name,
            dimension=desired_dimension,
            metric="cosine",
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        while not pc.describe_index(settings.pinecone_index_name).status["ready"]:
            time.sleep(1)

    return pc.Index(settings.pinecone_index_name)

def get_vectorstore():
    global _vectorstore
    if _vectorstore is None:
        index = ensure_index()
        _vectorstore = PineconeVectorStore(
            index=index,
            embedding=get_embeddings(),
            namespace=settings.pinecone_namespace,
        )
    return _vectorstore

def get_retriever():
    return get_vectorstore().as_retriever(search_kwargs={"k": settings.top_k})

def add_documents(chunks):
    store = get_vectorstore()
    return store.add_documents(chunks)