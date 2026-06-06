' Launches start.bat with no visible console window.
' Used by the Task Scheduler startup entry.
Dim shell, dir
Set shell = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
shell.Run "cmd /c """ & dir & "\start.bat""", 0, False
