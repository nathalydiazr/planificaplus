import React, { useState, useEffect } from "react";
import Login from "./Loginogin";
import App from "./App"; // tu archivo Planifica+ actual
import { auth } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

function Apps() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  if (!user) return <Login onLogin={() => setUser(true)} />;

  return (
    <div>
      <button onClick={() => signOut(auth)}>Cerrar sesión</button>
      <App />
    </div>
  );
}

export default Apps;
