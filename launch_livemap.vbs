Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
LocalAppData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
LogDir = LocalAppData & "\Livemap\logs"

' Ensure log directory exists
If Not fso.FolderExists(LocalAppData & "\Livemap") Then
    fso.CreateFolder(LocalAppData & "\Livemap")
End If
If Not fso.FolderExists(LogDir) Then
    fso.CreateFolder(LogDir)
End If

CollectorCmd = "cmd /c """"" & ScriptDir & "\bgp-collector.exe"" --mmdb """ & ScriptDir & "\dbip-city-lite.mmdb"" --db-dir """ & LocalAppData & "\Livemap\db"" >> """ & LogDir & "\collector.log"" 2>&1"""
' Run collector hidden (0)
WshShell.Run CollectorCmd, 0, False

ViewerCmd = "cmd /c """"" & ScriptDir & "\bgp-viewer.exe"" >> """ & LogDir & "\viewer.log"" 2>&1"""
' Run viewer normally (1) so if it needs a console, it has one, but Ebiten creates its own window
WshShell.Run ViewerCmd, 1, False
