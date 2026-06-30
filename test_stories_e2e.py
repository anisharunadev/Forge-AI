from fastapi.testclient import TestClient
from app.main import app
from datetime import datetime, timedelta, timezone
from jose import jwt

SECRET = 'dev-jwt-secret-change-in-production-min-32-chars-long'
claims = {
    'sub': '00000000-0000-0000-0000-000000000001',
    'email': 'admin@acme.example',
    'forge.tenant': '11111111-1111-1111-1111-111111111111',
    'forge.project': '22222222-2222-2222-2222-222222222222',
    'realm_access': {'roles': ['forge:admin']},
    'forge.permissions': ['stories:read','stories:write','sprints:read','sprints:write','epics:read'],
    'exp': datetime.now(timezone.utc) + timedelta(hours=2),
    'iat': datetime.now(timezone.utc),
}
token = jwt.encode(claims, SECRET, algorithm='HS256')
c = TestClient(app)
H = {'Authorization': f'Bearer {token}'}

r1 = c.post('/api/v1/stories', headers=H, json={'title':'E2E story','priority':'P1','estimate':'S'})
print('POST /stories:', r1.status_code)
r2 = c.get('/api/v1/stories', headers=H)
print('GET  /stories:', r2.status_code, '|', r2.text[:300])
r3 = c.get('/api/v1/sprints', headers=H)
print('GET  /sprints:', r3.status_code, '|', r3.text[:200])
r4 = c.get('/api/v1/epics', headers=H)
print('GET  /epics  :', r4.status_code, '|', r4.text[:200])