from pathlib import Path
path = Path(''client/src/App.js'')
text = path.read_text()
old = "const handleLogout = async () => {\n    await signOut(auth);\n    setUser(null);\n    setEmail(rememberMe ? localStorage.getItem(\"planifica_email\") or \"\" : \"\");\n    setPassword(\"\");\n    setUserMeta({ isPaid: False, status: \"\" });\n    setProofMessage(\"\");\n    setShowUploadModal(False);\n    setProofFile(None);\n    setProofNote(\"\");\n    // mantenemos rememberMe tal como lo dejó el usuario\n  };"
