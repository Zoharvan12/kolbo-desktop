; Kolbo Studio - NSIS Installer Script
; Automatically closes running instances before installation

!macro customInit
  ; Close all running instances of Kolbo Studio (all variants)
  DetailPrint "Checking for running instances of Kolbo Studio..."

  ; Kill all possible Kolbo Studio processes
  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio.exe" /T'
  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio Dev.exe" /T'
  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio Staging.exe" /T'

  ; Wait a moment for processes to fully close
  Sleep 1000

  DetailPrint "All running instances closed"
!macroend

!macro customInstall
  ; Additional install actions if needed
  DetailPrint "Installing Kolbo Studio..."
!macroend

!macro customUnInstall
  ; Close app before uninstalling
  DetailPrint "Closing Kolbo Studio..."

  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio.exe" /T'
  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio Dev.exe" /T'
  nsExec::ExecToStack 'taskkill /F /IM "Kolbo Studio Staging.exe" /T'

  Sleep 1000

  DetailPrint "Kolbo Studio closed"
!macroend
