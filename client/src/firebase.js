import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyB96uWtfCdh00_jkCYmzMsPG8U-ac1MFLU",
  authDomain: "planificaplus-a75f2.firebaseapp.com",
  projectId: "planificaplus-a75f2",
  storageBucket: "planificaplus-a75f2.firebasestorage.app",
  messagingSenderId: "638670630086",
  appId: "1:638670630086:web:4782917f285847161ffbc7"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
