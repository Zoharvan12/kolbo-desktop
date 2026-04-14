; Sapir AI Studio - NSIS Installer Script
; Automatically closes running instances before installation

!macro customInit
  DetailPrint "Checking for running instances of Sapir AI Studio..."
  nsExec::ExecToStack 'taskkill /F /IM "Sapir AI Studio.exe" /T'
  Sleep 1000
  DetailPrint "All running instances closed"
!macroend

!macro customInstall
  DetailPrint "Installing Sapir AI Studio..."
!macroend

!macro customUnInstall
  DetailPrint "Closing Sapir AI Studio..."
  nsExec::ExecToStack 'taskkill /F /IM "Sapir AI Studio.exe" /T'
  Sleep 1000
  DetailPrint "Sapir AI Studio closed"
!macroend
