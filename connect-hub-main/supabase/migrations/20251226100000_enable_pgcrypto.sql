-- Enable pgcrypto for gen_random_uuid/gen_random_bytes.
create extension if not exists pgcrypto;
