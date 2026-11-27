!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities" "ApplicationName" "Mojian"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities" "ApplicationDescription" "Mojian Markdown 写作与编辑器"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities\FileAssociations" ".md" "Mojian.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities\FileAssociations" ".markdown" "Mojian.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities\FileAssociations" ".mdown" "Mojian.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities\FileAssociations" ".mkdn" "Mojian.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\Mojian\Capabilities\FileAssociations" ".mkd" "Mojian.Markdown"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "Mojian" "Software\Mojian\Capabilities"
  !insertmacro UPDATEFILEASSOC
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "Mojian"
  DeleteRegKey SHELL_CONTEXT "Software\Mojian\Capabilities"
!macroend
