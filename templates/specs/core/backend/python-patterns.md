---
domain: backend
name: python-patterns
specId: SPEC:be-py-001
updated: 2026-04-15
confidence: 0.9
tags: [python, fastapi, django, pydantic, sqlalchemy, pytest, alembic, flask]
rules:
  - type: grep_must_not_exist
    pattern: "print\\("
    files: "**/*.py"
    message: "Use structured logger, not print() (SPEC:be-py-001)"
  - type: grep_must_not_exist
    pattern: "from django\\.contrib\\.auth\\.models import User"
    files: "**/*.py"
    message: "Use custom User model via get_user_model(), not django.contrib.auth.models.User (SPEC:be-py-001)"
  - type: import_boundary
    from: "app/services/**"
    cannot_import: ["app/views/**", "app/templates/**"]
    message: "Service layer cannot import from view/template layer (SPEC:be-py-001)"
---
# Python Backend Patterns

Stack-specific reference for SPEC:be-001 (API), SPEC:be-002 (Auth), SPEC:be-003 (DB), SPEC:test-001 (Testing).

---

## Config: Pydantic BaseSettings (fail-fast, typed)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    debug: bool = False

    model_config = {"env_file": ".env"}

settings = Settings()  # Fails at startup if required vars missing
```

## API: FastAPI Input Validation

```python
from pydantic import BaseModel, EmailStr, Field

class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
    name: str = Field(min_length=1, max_length=100)

@router.post("/users", status_code=201)
async def create_user(body: CreateUserRequest, db: Session = Depends(get_db)):
    user = UserService.create(db, body)
    return {"data": UserResponse.model_validate(user)}
```

## API: Consistent Error Response

```python
from fastapi import HTTPException
from fastapi.responses import JSONResponse

@app.exception_handler(HTTPException)
async def http_error_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.detail, "message": str(exc.detail)}},
    )
```

## Auth: FastAPI Dependency Injection

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    try:
        payload = jwt.decode(credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user
```

## Auth: Password Hashing

```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
```

## DB: SQLAlchemy Session Management

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url, pool_size=5, max_overflow=10)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

## DB: Alembic Migration (additive-only)

```python
# Always: add column nullable first, backfill, then add constraint
def upgrade():
    op.add_column('orders', sa.Column('currency', sa.String(3), nullable=True))
    # Backfill in batches via data migration, NOT here

def downgrade():
    op.drop_column('orders', 'currency')
```

## DB: Django N+1 Prevention

```python
# select_related for FK/OneToOne (SQL JOIN)
orders = Order.objects.select_related('user').all()

# prefetch_related for ManyToMany/reverse FK (2 queries)
orders = Order.objects.prefetch_related('items').all()

# Combined
orders = Order.objects.select_related('user').prefetch_related('items').all()
```

## DB: Django Custom User Model (BEFORE first migrate)

```python
from django.contrib.auth.models import AbstractUser
from django.db import models
import uuid

class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        db_table = 'users'

# settings.py: AUTH_USER_MODEL = 'users.User'
```

## Testing: pytest + factory_boy

```python
import factory
import pytest

class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = 'users.User'
    email = factory.Sequence(lambda n: f'user{n}@example.com')
    username = factory.Sequence(lambda n: f'user{n}')

@pytest.fixture
def api_client():
    from rest_framework.test import APIClient
    return APIClient()

@pytest.fixture
def auth_client(api_client):
    user = UserFactory()
    api_client.force_authenticate(user=user)
    return api_client

@pytest.mark.django_db
class TestCreateOrder:
    def test_creates_order(self, auth_client):
        response = auth_client.post('/api/orders/', {'items': [{'product_id': 1, 'quantity': 2}]})
        assert response.status_code == 201
        assert 'data' in response.json()

    def test_rejects_unauthenticated(self, api_client):
        response = api_client.post('/api/orders/', {})
        assert response.status_code == 401
```

## Django: Service Layer Pattern

```python
# services.py — business logic lives here, NOT in views
from django.db import transaction

class OrderService:
    @staticmethod
    @transaction.atomic
    def create_order(user, items_data: list[dict]):
        total = sum(i['price'] * i['quantity'] for i in items_data)
        order = Order.objects.create(user=user, total=total)
        OrderItem.objects.bulk_create([OrderItem(order=order, **i) for i in items_data])
        return order
```

## Anti-Patterns (Python-Specific)

| # | Don't | Do Instead |
|---|-------|------------|
| 1 | `print()` in production code | `logging.getLogger(__name__)` |
| 2 | `from django.contrib.auth.models import User` | `get_user_model()` or custom model |
| 3 | Django fixtures (JSON/YAML) | `factory_boy` factories |
| 4 | `runserver` in production | Gunicorn + Nginx |
| 5 | Single `settings.py` | Split: base.py + dev.py + prod.py |
| 6 | Business logic in views | Service layer (`services.py`) |
| 7 | No `select_related`/`prefetch_related` | Always eager-load related objects |
| 8 | `ModelSerializer` for write operations | Explicit input serializer |
| 9 | Edit/delete applied migrations | Migrations are append-only |
| 10 | Raw SQL in views | ORM querysets + `selectors.py` |
