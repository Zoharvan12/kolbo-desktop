// Custom Windows code signing hook for electron-builder.
// Called once per signable file (.exe, .dll inside the asar, etc.).
// No-op when CODESIGN_TOOL_PATH is unset (local builds).
const { execFileSync } = require('child_process');
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

  const jarPath = path.join(toolPath, 'CodeSignTool.jar');
  console.log(`  🔏 Signing ${path.basename(filePath)} via SSL.com eSigner...`);

  execFileSync('java', [
    '-jar', jarPath,
    'sign',
    `-username=${username}`,
    `-password=${password}`,
    `-credential_id=${credentialId}`,
    `-totp_secret=${totpSecret}`,
    `-input_file_path=${filePath}`,
    '-override',
  ], { stdio: 'inherit' });

  console.log(`  ✅ Signed: ${path.basename(filePath)}`);
};
