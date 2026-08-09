import os
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from sqlalchemy import create_engine, Column, Integer, String, Text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
import resend
import time

load_dotenv()

# --- SECURITY ---
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
SECRET_TOKEN = os.getenv("SECRET_TOKEN")
resend.api_key = os.getenv("RESEND_API_KEY")

api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

FAILED_LOGINS = {}
MAX_ATTEMPTS = 5
LOCKOUT_DURATION = 900 

def verify_admin(token: str = Security(api_key_header)):
    if token != f"Bearer {SECRET_TOKEN}":
        raise HTTPException(status_code=403, detail="Unauthorized")
    return True

# --- DATABASE SETUP (Turso Integration) ---
TURSO_URL = os.getenv("TURSO_URL", "")
TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

# Automatically format the Turso URL for SQLAlchemy
if TURSO_URL.startswith("libsql://"):
    formatted_url = TURSO_URL.replace("libsql://", "sqlite+libsql://")
    SQLALCHEMY_DATABASE_URL = f"{formatted_url}/?authToken={TURSO_AUTH_TOKEN}&secure=true"
else:
    # Fallback for local testing if variables aren't set
    SQLALCHEMY_DATABASE_URL = "sqlite:///./data/leamen_cms.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class PostDB(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=True)
    date = Column(String, nullable=True)
    group = Column(String, index=True, nullable=True) 
    image = Column(String, nullable=True) 
    description = Column(Text, nullable=True)
    link = Column(String, nullable=True)
    linkText = Column(String, nullable=True)

Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------
# PYDANTIC MODELS
# ---------------------------------------------------------
class PostBase(BaseModel):
    title: Optional[str] = ""
    date: Optional[str] = ""
    group: Optional[str] = ""
    image: Optional[str] = ""
    description: Optional[str] = ""
    link: Optional[str] = ""
    linkText: Optional[str] = ""

class PostResponse(PostBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class ContactForm(BaseModel):
    email: str
    subject: str
    message: str

class LoginData(BaseModel):
    password: str

# ---------------------------------------------------------
# FASTAPI APPLICATION
# ---------------------------------------------------------
app = FastAPI(title="Leamenweb CMS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://leamenweb.com",
        "https://www.leamenweb.com",
        "http://localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- AUTHENTICATION ROUTE (Brute Force Protected) ---
@app.post("/api/login")
def login(req: Request, data: LoginData):
    ip = req.client.host
    current_time = time.time()
    
    # 1. Check if IP is currently locked out
    if ip in FAILED_LOGINS:
        attempts, lockout_time = FAILED_LOGINS[ip]
        if lockout_time and current_time < lockout_time:
            raise HTTPException(status_code=429, detail="Too many attempts. Locked out for 15 minutes.")
        elif lockout_time and current_time > lockout_time:
            FAILED_LOGINS[ip] = [0, None] # Reset lockout period expired

    # 2. Check Password
    if data.password == ADMIN_PASSWORD:
        FAILED_LOGINS[ip] = [0, None] # Reset on success
        return {"token": SECRET_TOKEN}
    
    # 3. Handle Failure & Lockout
    if ip not in FAILED_LOGINS:
        FAILED_LOGINS[ip] = [1, None]
    else:
        FAILED_LOGINS[ip][0] += 1
        if FAILED_LOGINS[ip][0] >= MAX_ATTEMPTS:
            FAILED_LOGINS[ip][1] = current_time + LOCKOUT_DURATION
            raise HTTPException(status_code=429, detail="Too many attempts. Locked out for 15 minutes.")
            
    raise HTTPException(status_code=401, detail="Invalid password")


# --- PUBLIC ROUTES ---
@app.get("/api/posts", response_model=List[PostResponse])
def get_posts(db: Session = Depends(get_db)):
    return db.query(PostDB).order_by(PostDB.id.desc()).all()

@app.post("/api/contact")
def send_contact_email(form: ContactForm):
    try:
        email_data = {
            "from": "onboarding@resend.dev", 
            "to": "vincentvn77@gmail.com",
            "subject": f"{form.subject} - from leamenweb",
            "reply_to": form.email,
            "text": f"Message from: {form.email}\n\n{form.message}"
        }
        resend.Emails.send(email_data)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- PROTECTED CMS ROUTES (Require Admin Token) ---
@app.post("/api/posts", response_model=PostResponse, dependencies=[Depends(verify_admin)])
def create_post(post: PostBase, db: Session = Depends(get_db)):
    db_post = PostDB(**post.model_dump())
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    return db_post

@app.put("/api/posts/{post_id}", response_model=PostResponse, dependencies=[Depends(verify_admin)])
def update_post(post_id: int, post_update: PostBase, db: Session = Depends(get_db)):
    db_post = db.query(PostDB).filter(PostDB.id == post_id).first()
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    update_data = post_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_post, key, value)
        
    db.commit()
    db.refresh(db_post)
    return db_post

@app.delete("/api/posts/{post_id}", dependencies=[Depends(verify_admin)])
def delete_post(post_id: int, db: Session = Depends(get_db)):
    db_post = db.query(PostDB).filter(PostDB.id == post_id).first()
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    db.delete(db_post)
    db.commit()
    return {"status": "success"}