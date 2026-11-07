-- Invitation tokens are stored as their SHA-256 hex digest from this release
-- on (hashInvitationToken in src/lib/tokens.ts); the column keeps its name.
-- Hash any token written raw before then, so links already sent keep working.
-- A raw token is 32 base64url characters and can never look like 64 lowercase
-- hex digits, so a row that already holds a hash is left alone.
UPDATE "invitations"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "token" !~ '^[0-9a-f]{64}$';
