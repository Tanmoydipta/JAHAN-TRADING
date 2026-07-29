"""Lightweight at-rest encryption for the sensitive fields of database_config.

Not a substitute for a real secrets manager, but keeps the raw DB host/user/
password/database out of plain text inside the shipped config.json. The app
decrypts automatically at startup using the fixed passphrase below — the
client never sees or enters anything.

Stdlib only (hashlib PBKDF2 + a SHA256-based keystream) so PyInstaller
doesn't need to bundle a third-party crypto dependency.
"""
import base64
import hashlib
import json
import os

PASSPHRASE = "tanm1234"

_PBKDF2_ITERATIONS = 200_000


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(key + nonce + counter.to_bytes(8, 'big')).digest()
        counter += 1
    return bytes(out[:length])


def encrypt_dict(data: dict, passphrase: str = PASSPHRASE) -> str:
    plaintext = json.dumps(data).encode('utf-8')
    salt = os.urandom(16)
    nonce = os.urandom(16)
    key = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, _PBKDF2_ITERATIONS)
    ks = _keystream(key, nonce, len(plaintext))
    ciphertext = bytes(a ^ b for a, b in zip(plaintext, ks))
    return base64.b64encode(salt + nonce + ciphertext).decode('ascii')


def decrypt_dict(blob_b64: str, passphrase: str = PASSPHRASE) -> dict:
    blob = base64.b64decode(blob_b64)
    salt, nonce, ciphertext = blob[:16], blob[16:32], blob[32:]
    key = hashlib.pbkdf2_hmac('sha256', passphrase.encode('utf-8'), salt, _PBKDF2_ITERATIONS)
    ks = _keystream(key, nonce, len(ciphertext))
    plaintext = bytes(a ^ b for a, b in zip(ciphertext, ks))
    return json.loads(plaintext.decode('utf-8'))
