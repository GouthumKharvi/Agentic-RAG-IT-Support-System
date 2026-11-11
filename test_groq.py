import os
from dotenv import load_dotenv
from langchain_groq import ChatGroq

load_dotenv(override=True)  # Forces .env to override system environment variables

groq_key = os.getenv("GROQ_API_KEY")
print(f"Loaded Key (First 10 chars): '{groq_key[:10] if groq_key else 'NONE'}'")

try:
    llm = ChatGroq(model_name="openai/gpt-oss-120b", groq_api_key=groq_key)
    res = llm.invoke("Hi")
    print("SUCCESS:", res.content)
except Exception as e:
    print("ERROR:", e)