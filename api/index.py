import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict
from typing import List, Optional
import httpx
import resend
import time

load_dotenv()

app = FastAPI(title="Leamenweb CMS API")

# --- SECURITY ---
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
SECRET_TOKEN = os.getenv("SECRET_TOKEN")
resend.api_key = os.getenv("RESEND_API_KEY")

# Fix: Dynamically convert libsql:// to https:// for the httpx client
_raw_url = os.getenv("TURSO_URL", "").rstrip("/")
if _raw_url.startswith("libsql://"):
    TURSO_URL = _raw_url.replace("libsql://", "https://")
else:
    TURSO_URL = _raw_url

TURSO_AUTH_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")

api_key_header = APIKeyHeader(name="Authorization", auto_error=False)
FAILED_LOGINS = {}
MAX_ATTEMPTS = 5
LOCKOUT_DURATION = 900 

def verify_admin(token: str = Security(api_key_header)):
    if token != f"Bearer {SECRET_TOKEN}":
        raise HTTPException(status_code=403, detail="Unauthorized")
    return True

# Helper to execute queries against Turso HTTP API
def execute_turso(sql: str, args: list = None):
    url = f"{TURSO_URL}/v2/pipeline"
    headers = {
        "Authorization": f"Bearer {TURSO_AUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    
    formatted_args = []
    if args:
        for arg in args:
            if arg is None:
                formatted_args.append({"type": "null"})
            elif isinstance(arg, int):
                formatted_args.append({"type": "integer", "value": str(arg)})
            else:
                formatted_args.append({"type": "text", "value": str(arg)})

    payload = {
        "requests": [
            {
                "type": "execute",
                "stmt": {
                    "sql": sql,
                    "args": formatted_args
                }
            },
            {
                "type": "close"
            }
        ]
    }
    
    with httpx.Client() as client:
        response = client.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Database error: {response.text}")
        
        data = response.json()
        result_set = data["results"][0]
        if "error" in result_set:
            raise HTTPException(status_code=500, detail=result_set["error"]["message"])
        
        return result_set.get("response", {}).get("result", {})

# Fix: Run table initialization synchronously so Vercel executes it on cold start
def init_db():
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        date TEXT,
        group_name TEXT,
        image TEXT,
        description TEXT,
        link TEXT,
        linkText TEXT
    );
    """
    try:
        execute_turso(create_table_sql)
    except Exception as e:
        print("Table init warning:", e)

init_db()

# --- PYDANTIC MODELS ---
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
    group: Optional[str] = ""
    model_config = ConfigDict(from_attributes=True)

class ContactForm(BaseModel):
    email: str
    subject: str
    message: str

class LoginData(BaseModel):
    password: str

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://leamenweb.com", "https://www.leamenweb.com", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROUTES ---
@app.post("/api/login")
def login(req: Request, data: LoginData):
    ip = req.client.host
    current_time = time.time()
    
    if ip in FAILED_LOGINS:
        attempts, lockout_time = FAILED_LOGINS[ip]
        if lockout_time and current_time < lockout_time:
            raise HTTPException(status_code=429, detail="Too many attempts. Locked out for 15 minutes.")
        elif lockout_time and current_time > lockout_time:
            FAILED_LOGINS[ip] = [0, None]

    if data.password == ADMIN_PASSWORD:
        FAILED_LOGINS[ip] = [0, None]
        return {"token": SECRET_TOKEN}
    
    if ip not in FAILED_LOGINS:
        FAILED_LOGINS[ip] = [1, None]
    else:
        FAILED_LOGINS[ip][0] += 1
        if FAILED_LOGINS[ip][0] >= MAX_ATTEMPTS:
            FAILED_LOGINS[ip][1] = current_time + LOCKOUT_DURATION
            raise HTTPException(status_code=429, detail="Too many attempts. Locked out for 15 minutes.")
            
    raise HTTPException(status_code=401, detail="Invalid password")

@app.get("/api/posts")
def get_posts():
    res = execute_turso("SELECT id, title, date, group_name, image, description, link, linkText FROM posts ORDER BY id DESC;")
    rows = res.get("rows", [])
    posts = []
    for row in rows:
        posts.append({
            "id": int(row[0]["value"]), # Cast string ID to integer
            "title": row[1].get("value", "") if row[1] else "",
            "date": row[2].get("value", "") if row[2] else "",
            "group": row[3].get("value", "") if row[3] else "",
            "image": row[4].get("value", "") if row[4] else "",
            "description": row[5].get("value", "") if row[5] else "",
            "link": row[6].get("value", "") if row[6] else "",
            "linkText": row[7].get("value", "") if row[7] else ""
        })
    return posts

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

@app.post("/api/posts", dependencies=[Depends(verify_admin)])
def create_post(post: PostBase):
    sql = "INSERT INTO posts (title, date, group_name, image, description, link, linkText) VALUES (?, ?, ?, ?, ?, ?, ?);"
    execute_turso(sql, [post.title, post.date, post.group, post.image, post.description, post.link, post.linkText])
    
    # Fetch latest created post to return
    res = execute_turso("SELECT id, title, date, group_name, image, description, link, linkText FROM posts ORDER BY id DESC LIMIT 1;")
    row = res.get("rows", [])[0]
    return {
        "id": int(row[0]["value"]), # Cast string ID to integer
        "title": row[1].get("value", "") if row[1] else "",
        "date": row[2].get("value", "") if row[2] else "",
        "group": row[3].get("value", "") if row[3] else "",
        "image": row[4].get("value", "") if row[4] else "",
        "description": row[5].get("value", "") if row[5] else "",
        "link": row[6].get("value", "") if row[6] else "",
        "linkText": row[7].get("value", "") if row[7] else ""
    }

@app.put("/api/posts/{post_id}", dependencies=[Depends(verify_admin)])
def update_post(post_id: int, post_update: PostBase):
    sql = "UPDATE posts SET title=?, date=?, group_name=?, image=?, description=?, link=?, linkText=? WHERE id=?;"
    execute_turso(sql, [post_update.title, post_update.date, post_update.group, post_update.image, post_update.description, post_update.link, post_update.linkText, post_id])
    return {"id": post_id, **post_update.model_dump()}

@app.delete("/api/posts/{post_id}", dependencies=[Depends(verify_admin)])
def delete_post(post_id: int):
    execute_turso("DELETE FROM posts WHERE id = ?;", [post_id])
    return {"status": "success"}