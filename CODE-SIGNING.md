# Code Signing Setup for Kolbo Desktop

## Why Code Signing is Required

Windows **requires** code signing for auto-updates to work. Without it, users will see this error:
```
Error: New version X.X.X is not signed by the application owner
```

## Getting a Code Signing Certificate

### Option 1: SSL.com (Recommended - $200/year)
1. Go to: https://www.ssl.com/certificates/ev-code-signing/
2. Purchase "EV Code Signing Certificate" (required for Windows)
3. Complete identity verification (1-3 business days)
4. Download your certificate as `.pfx` file

### Option 2: DigiCert ($300/year)
1. Go to: https://www.digicert.com/signing/code-signing-certificates
2. Purchase certificate and complete verification
3. Download as `.pfx` file

### Option 3: Sectigo ($200/year)
1. Go to: https://sectigo.com/ssl-certificates-tls/code-signing
2. Purchase and verify identity
3. Download certificate

## Installing the Certificate

### Step 1: Save Certificate File

```bash
# Create certs directory (excluded from git)
mkdir certs

# Save your certificate as:
# G:\Projects\Kolbo.AI\github\kolbo-desktop\certs\windows-certificate.pfx
```

### Step 2: Set Password Environment Variable

**Permanent (Recommended):**
```bash
setx WIN_CSC_KEY_PASSWORD "your_certificate_password"
```

**Temporary (Current session):**
```bash
set WIN_CSC_KEY_PASSWORD=your_certificate_password
```

### Step 3: Verify Setup

The certificate file should be at:
```
G:\Projects\Kolbo.AI\github\kolbo-desktop\certs\windows-certificate.pfx
```

The `.gitignore` already excludes `certs/` directory - your certificate will NOT be committed to git.

## Building Signed Installer

Once certificate is set up, build normally:

```bash
npm run build:prod:win
```

The installer will be automatically signed during build!

## Verifying Signature

After building, verify the signature:

```powershell
# Check signature
Get-AuthenticodeSignature "dist\Kolbo Studio-Setup-X.X.X.exe" | Format-List

# Should show:
# Status: Valid
# SignerCertificate: CN=Kolbo.AI
```

## Auto-Update Configuration

The `package.json` is already configured:

```json
{
  "win": {
    "certificateFile": "certs/windows-certificate.pfx",
    "certificatePassword": "${env.WIN_CSC_KEY_PASSWORD}",
    "signingHashAlgorithms": ["sha256"],
    "signAndEditExecutable": true,
    "publisherName": "Kolbo.AI"
  }
}
```

## CI/CD Setup (GitHub Actions)

For automated builds, add secrets to GitHub:

1. Go to: https://github.com/Zoharvan12/kolbo-desktop/settings/secrets/actions
2. Add secrets:
   - `WIN_CSC_LINK`: Base64 encoded certificate
   - `WIN_CSC_KEY_PASSWORD`: Certificate password

To encode certificate:
```bash
certutil -encode certs\windows-certificate.pfx certs\certificate-base64.txt
```

## Costs

- **Code Signing Certificate**: $200-300/year
- **Required for**: Production releases with auto-update
- **Valid for**: 1-3 years (depending on provider)

## Troubleshooting

### "Certificate not found" error
- Ensure `certs/windows-certificate.pfx` exists
- Check file path in package.json

### "Invalid password" error
- Verify `WIN_CSC_KEY_PASSWORD` is set correctly
- Try setting it again with `setx`

### "Certificate expired" error
- Renew your certificate before expiration
- Most providers send renewal reminders

## For Development/Testing

If you don't have a certificate yet:
1. Users must manually download and install updates
2. Auto-update will show signature errors
3. Get a certificate ASAP for production use

**Current Status**: ⚠️ Certificate not configured - auto-updates will fail

---

## Quick Checklist

- [ ] Purchase code signing certificate (~$200/year)
- [ ] Save certificate to `certs/windows-certificate.pfx`
- [ ] Set `WIN_CSC_KEY_PASSWORD` environment variable
- [ ] Test build: `npm run build:prod:win`
- [ ] Verify signature with PowerShell
- [ ] Release signed version
- [ ] Auto-updates will work! ✅

---

**Next Steps**:
1. Purchase certificate from SSL.com, DigiCert, or Sectigo
2. Complete identity verification (1-3 days)
3. Follow setup steps above
4. Rebuild and release signed version

Once signed, users on v1.0.4 will be able to auto-update to newer versions!
