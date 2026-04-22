// Custom Windows code signing hook for electron-builder.
// Called once per signable file (.exe inside the installer, etc.).
// No-op when CODESIGN_TOOL_PATH is unset (local builds).
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function sign(configuration) {
  const filePath = configuration.path;
  if (!filePath.endsWith('.exe')) return;

  const toolPath = process.env.CODESIGN_TOOL_PATH;
  if (!toolPath) {
    console.log('  ⚠  CODESIGN_TOOL_PATH not set — skipping Windows signing');
    return;
  }

  const username     = process.env.SSLCOM_USERNAME;
  const password     = process.env.SSLCOM_PASSWORD;
  const credentialId = process.env.SSLCOM_CREDENTIAL_ID;
  const totpSecret   = process.env.SSLCOM_TOTP_SECRET;

  if (!username || !password || !credentialId || !totpSecret) {
    console.log('  ⚠  SSL.com credentials not complete — skipping Windows signing');
    return;
  }

  const batPath = path.join(toolPath, 'CodeSignTool.bat');
  console.log(`  🔏 Signing ${path.basename(filePath)} via SSL.com eSigner...`);

  // Use execSync so the .bat runs through cmd, which is required on Windows.
  // Arguments are double-quoted to handle special characters (@ in password, = in TOTP).
  execSync(
    `"${batPath}" sign -username="${username}" -password="${password}" -credential_id="${credentialId}" -totp_secret="${totpSecret}" -input_file_path="${filePath}" -override`,
    { stdio: 'inherit' }
  );

  console.log(`  ✅ Signed: ${path.basename(filePath)}`);
};
