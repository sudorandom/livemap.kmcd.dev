Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
LocalAppData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")

CollectorCmd = """" & ScriptDir & "\bgp-collector.exe"" --mmdb """ & ScriptDir & "\dbip-city-lite.mmdb"" --db-dir """ & LocalAppData & "\Livemap\db"""
WshShell.Run CollectorCmd, 0, False

ViewerCmd = """" & ScriptDir & "\bgp-viewer.exe"""
WshShell.Run ViewerCmd, 1, False
