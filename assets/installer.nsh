; Custom NSIS hooks for Dhee, auto-included by electron-builder from the
; buildResources dir (build.directories.buildResources = "assets").
;
; Reset the first-run onboarding marker on a GENUINE uninstall so a later
; fresh re-install shows the quickstart setup again.
;
; electron-builder sets ${isUpdated} when the uninstaller runs as part of
; an in-place update (electron-updater), and ${ifNot} ${isUpdated} is the
; same guard the built-in deleteAppDataOnUninstall path uses. So:
;   - real uninstall (user-initiated, or running the installer over an old
;     version) -> reset the flag -> next install shows the quickstart.
;   - auto-update -> flag preserved -> users aren't re-onboarded on update.
;
; Only the onboarding marker is removed; settings, API keys, and projects
; (the other files under the userData dir) are left untouched.
;
; The folder is electron's userData dir, which is app.getName() === the
; package "name" ("dhee-desktop"), NOT the productName ("Dhee").
; $APPDATA here is %APPDATA% (Roaming), matching electron's appData path
; for this per-user (perMachine:false) install.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Delete "$APPDATA\dhee-desktop\dhee-onboarding.json"
  ${endIf}
!macroend
