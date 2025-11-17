// src/App.js
import { db, auth, googleProvider, storage } from "./firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  writeBatch,
} from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Line, Pie, Bar } from "react-chartjs-2";
import "chart.js/auto";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  signInWithPopup,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import "./App.css";

const ADMIN_EMAILS = ["nathalydiazrosales@gmail.com"];
const ADMIN_EMAILS_LOWER = ADMIN_EMAILS.map((email) => email.toLowerCase());
const SUPPORT_WHATSAPP = "51937698884"; // formato internacionales

/* ---------- Helpers ---------- */
function monthKeyFromDate(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  const date = new Date(+y, +m - 1, 1);
  return date.toLocaleString("es-PE", { month: "short", year: "numeric" });
}
function formatCurrency(n) {
  return `S/. ${Number(n || 0).toFixed(2)}`;
}

/* ---------- Assistant Component INTELIGENTE (fecha natural + análisis) ---------- */
function AssistantFloating({ gastos, ingresos }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [anim, setAnim] = useState(false);

  useEffect(() => {
    if (open) {
      setAnim(true);
      const t = setTimeout(() => setAnim(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  /** -----------------------------
   * UTILIDADES DE FECHAS
   * ----------------------------- */

  const normalize = (s) =>
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const toDate = (d) => {
    if (typeof d === "string") return new Date(d);
    return d instanceof Date ? d : new Date(d);
  };

  
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

  const startOfWeek = (d) => {
    const r = new Date(d);
    const day = r.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Lunes = 1
    r.setDate(r.getDate() + diff);
    r.setHours(0, 0, 0, 0);
    return r;
  };

  const endOfWeek = (d) => {
    const s = startOfWeek(d);
    const r = new Date(s);
    r.setDate(r.getDate() + 6);
    r.setHours(23, 59, 59, 999);
    return r;
  };

  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

  /** -----------------------------
   * PARSER DE FECHA NATURAL
   * ----------------------------- */

  const parseTimeRange = (text) => {
    const t = normalize(text);
    const today = startOfDay(new Date());

    // Hoy
    if (t.includes("hoy")) return { start: today, end: endOfDay(today), label: "hoy" };

    // Ayer
    if (t.includes("ayer")) {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { start: startOfDay(d), end: endOfDay(d), label: "ayer" };
    }

    // Esta semana
    if (t.includes("esta semana")) {
      return {
        start: startOfWeek(today),
        end: endOfWeek(today),
        label: "esta semana",
      };
    }

    // Semana pasada
    if (t.includes("semana pasada")) {
      const s = startOfWeek(today);
      s.setDate(s.getDate() - 7);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      e.setHours(23, 59, 59);
      return { start: s, end: e, label: "la semana pasada" };
    }

    // Este mes
    if (t.includes("este mes")) {
      return {
        start: startOfMonth(today),
        end: endOfMonth(today),
        label: "este mes",
      };
    }

    // Mes pasado
    if (t.includes("mes pasado")) {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      last.setHours(23, 59, 59);
      return { start: first, end: last, label: "el mes pasado" };
    }

    // Últimos X días
    const matchLast = t.match(/ultimos (\d+) dias/);
    if (matchLast) {
      const n = Number(matchLast[1]);
      const s = new Date(today);
      s.setDate(s.getDate() - n + 1);
      return { start: s, end: endOfDay(today), label: `los últimos ${n} días` };
    }

    // Rangos "entre el 5 y el 20"
    const matchRange = t.match(/entre el (\d{1,2}) y el (\d{1,2})/);
    if (matchRange) {
      const d1 = Number(matchRange[1]);
      const d2 = Number(matchRange[2]);
      const month = today.getMonth();
      const year = today.getFullYear();
      return {
        start: new Date(year, month, d1),
        end: new Date(year, month, d2, 23, 59, 59),
        label: `del ${d1} al ${d2} de este mes`,
      };
    }

    // Si no se detectó, retornar null
    return null;
  };

  /** -----------------------------
   * FILTRAR REGISTROS POR PERIODO
   * ----------------------------- */
  const filterByRange = (arr, start, end) => {
    return arr.filter((x) => {
      const d = toDate(x.fecha);
      return d >= start && d <= end;
    });
  };

  /** -----------------------------
   * HANDLER PRINCIPAL
   * ----------------------------- */

  const handleAsk = (input) => {
    const text = normalize(input || q);
    if (!text.trim()) {
      setAnswer("Escribe una pregunta como: '¿Cuánto gasté esta semana?'");
      return;
    }

    // 1. Detectar rango de tiempo
    const range = parseTimeRange(text);
    if (!range) {
      setAnswer("No entendí el período. Intenta: hoy, ayer, esta semana, este mes, o 'entre el 5 y el 20'.");
      return;
    }

    const { start, end, label } = range;

    // 2. Filtrar registros
    const g = filterByRange(gastos, start, end);
    const i = filterByRange(ingresos, start, end);

    const sum = (arr) => arr.reduce((a, b) => a + Number(b.monto || 0), 0);
    const totalG = sum(g);
    const totalI = sum(i);
    const balance = totalI - totalG;

    // 3. Categorías principales
    const catTotals = {};
    g.forEach((x) => (catTotals[x.categoria] = (catTotals[x.categoria] || 0) + Number(x.monto)));
    const topCat =
      Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0] || null;

    // 4. Alertas simples
    const avgGastoHistorico =
      gastos.reduce((a, b) => a + Number(b.monto), 0) / Math.max(1, gastos.length);

    let alert = "";
    if (totalG > avgGastoHistorico * 1.4) {
      alert = "⚠️ Estás gastando más de lo habitual.";
    }

    // 5. Respuesta
    let msg = `📅 Período analizado: **${label}**\n\n`;

    msg += `💸 **Gastos:** S/. ${totalG.toFixed(2)}\n`;
    msg += `💰 **Ingresos:** S/. ${totalI.toFixed(2)}\n`;
    msg += `📊 **Balance:** ${balance >= 0 ? "positivo" : "negativo"} (S/. ${balance.toFixed(2)})\n`;

    if (topCat) {
      msg += `\n🏷️ Categoría con más gasto: **${topCat[0]}** (S/. ${topCat[1].toFixed(2)})\n`;
    }

    if (alert) msg += `\n${alert}\n`;

    // Si no hay datos
    if (g.length === 0 && i.length === 0) {
      msg += "\nNo se registraron movimientos en este período.";
    }

    setAnswer(msg);
  };

  /** -----------------------------
   * UI DEL ASISTENTE
   * ----------------------------- */

  return (
    <>
      <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 1200 }}>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            title="Asistente Planifica+"
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: "#2563eb",
              color: "#fff",
              border: "none",
              boxShadow: "0 8px 20px rgba(37,99,235,0.28)",
              cursor: "pointer",
              fontSize: 20,
            }}
          >
            💬
          </button>
        )}

        {open && (
          <div
            style={{
              width: 340,
              maxWidth: "92vw",
              borderRadius: 12,
              background: "#ffffff",
              boxShadow: "0 20px 45px rgba(2,6,23,0.16)",
              padding: 12,
              transform: anim ? "translateY(6px)" : "translateY(0)",
              opacity: anim ? 0.95 : 1,
              transition: "transform 220ms ease, opacity 220ms ease",
            }}
          >
            <div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  }}
>
  <div style={{ fontWeight: 700 }}>Asistente Planifica+</div>

  <button
    onClick={() => setOpen(false)}
    style={{
      background: "transparent",
      border: "none",
      cursor: "pointer",
      fontSize: 20,
      color: "#ef4444",
      lineHeight: "20px",
    }}
  >
    ✕
  </button>
</div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='Ej: "¿Cuánto gasté esta semana?"'
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e6edf3", marginBottom: 8 }}
            />

            <button
              onClick={() => handleAsk()}
              style={{ width: "100%", padding: 8, borderRadius: 8, background: "#2563eb", color: "#fff" }}
            >
              Preguntar
            </button>

            <div style={{ marginTop: 10, minHeight: 60, color: "#0f172a", fontSize: 14, whiteSpace: "pre-wrap" }}>
              {answer || <span style={{ color: "#64748b" }}>Aquí verás las respuestas</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}


/* ---------- Main App ---------- */
export default function App() {
  // Auth
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState(() => localStorage.getItem("planifica_email") || "");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("planifica_remember") === "1");
  const [loginError, setLoginError] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registerMessage, setRegisterMessage] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  // Post-login UX
  const [showSplash, setShowSplash] = useState(false);
  const [name, setName] = useState("");
  const [nameCommitted, setNameCommitted] = useState(false);

  // Records saved (local copy, but Firestore is source of truth)
  const [records, setRecords] = useState([]);
  useEffect(() => {
    try {
      localStorage.setItem("planifica_records_v1", JSON.stringify(records));
    } catch {}
  }, [records]);

  // UI state
  const [tab, setTab] = useState("registro"); // registro, estado, analisis
  const [message, setMessage] = useState("");
  const messageTimerRef = useRef(null);
  const [userMeta, setUserMeta] = useState({ isPaid: false, status: "" });
  const [metaLoading, setMetaLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [proofFile, setProofFile] = useState(null);
  const [proofNote, setProofNote] = useState("");
  const [proofMessage, setProofMessage] = useState("");
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [adminProofs, setAdminProofs] = useState([]);
  const [adminProofsLoading, setAdminProofsLoading] = useState(false);
  const [adminActionStatus, setAdminActionStatus] = useState({});
  const [savingRecord, setSavingRecord] = useState(false);
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [tempProfileName, setTempProfileName] = useState("");

  const isAdmin = !!(user && ADMIN_EMAILS_LOWER.includes((user.email || "").toLowerCase()));
  const supportWhatsAppLink = `https://api.whatsapp.com/send?phone=${SUPPORT_WHATSAPP}&text=${encodeURIComponent(
    "Hola Planifica+, necesito ayuda con mi cuenta."
  )}`;

  const showMessage = (text, duration = 2000) => {
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    setMessage(text);
    messageTimerRef.current = setTimeout(() => {
      setMessage("");
      messageTimerRef.current = null;
    }, duration);
  };

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []);


  useEffect(() => {
    if (!isAdmin) {
      setAdminProofs([]);
      setAdminProofsLoading(false);
      return;
    }
    setAdminProofsLoading(true);
    const coll = collection(db, "paymentProofs");
    const unsub = onSnapshot(
      coll,
      (snap) => {
        const arr = [];
        snap.forEach((d) => {
          const data = d.data();
          if (!data.status || data.status === "pending") {
            arr.push({ id: d.id, ...data });
          }
        });
        arr.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setAdminProofs(arr);
        setAdminProofsLoading(false);
      },
      (err) => {
        console.error("Error cargando comprobantes:", err);
        setAdminProofs([]);
        setAdminProofsLoading(false);
      }
    );
    return () => unsub();
  }, [isAdmin]);

  // register form state
  const [formKey, setFormKey] = useState(0);
  const [formTipo, setFormTipo] = useState(""); // gasto | ingreso
  const [formCategoria, setFormCategoria] = useState("");
  const [formMonto, setFormMonto] = useState("");
  const [formVoucher, setFormVoucher] = useState(null); // File
  const [formDescripcion, setFormDescripcion] = useState("");


  // categories sets
  const gastoCats = ["Comida", "Transporte", "Entretenimiento", "Hogar", "Cuidado personal", "Otros"];
  const ingresoCats = ["Sueldo", "Inversiones", "Alquiler", "Freelance", "Otros"];

  // File input ref (para botón Adjuntar funcional)
  const voucherInputRef = useRef(null);

  const resetFormFields = () => {
    setFormTipo("");
    setFormCategoria("");
    setFormMonto("");
    setFormVoucher(null);
    setFormDescripcion("");
    if (voucherInputRef.current) {
      voucherInputRef.current.value = "";
    }
    setFormKey((k) => k + 1);
  };

  const hydrateFormDraft = (uid) => {
    const draftRaw = localStorage.getItem(`planifica_form_${uid}`);
    if (!draftRaw) return;
    try {
      const parsed = JSON.parse(draftRaw);
      if ("formTipo" in parsed) setFormTipo(parsed.formTipo || "");
      if ("formCategoria" in parsed) setFormCategoria(parsed.formCategoria || "");
      if ("formMonto" in parsed) setFormMonto(parsed.formMonto || "");
      if ("formDescripcion" in parsed) setFormDescripcion(parsed.formDescripcion || "");
    } catch {
      // ignore malformed draft
    }
  };

  const fetchUserMeta = async (uid) => {
    if (!uid) return;
    setMetaLoading(true);
    try {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        setUserMeta({ isPaid: !!data?.isPaid, status: data?.status || "" });
      } else {
        setUserMeta({ isPaid: false, status: "" });
      }
    } catch (err) {
      console.error("Error obteniendo estado de pago:", err);
      setUserMeta({ isPaid: false, status: "" });
    } finally {
      setMetaLoading(false);
    }
  };

  const handleProofFileChange = (file) => {
    setProofFile(file || null);
  };

  const submitPaymentProof = async () => {
    if (!user) return;
    if (!proofFile && !proofNote.trim()) {
      setProofMessage("Adjunta un comprobante o escribe una nota.");
      setShowUploadModal(false);
      return;
    }
    setProofSubmitting(true);
    try {
      let proofUrl = "";
      if (proofFile) {
        const storageRef = ref(storage, `paymentProofs/${user.uid}/${Date.now()}_${proofFile.name}`);
        await uploadBytes(storageRef, proofFile);
        proofUrl = await getDownloadURL(storageRef);
      }

      const payload = {
        uid: user.uid,
        fileName: proofFile?.name || "",
        note: proofNote,
        createdAt: new Date().toISOString(),
        method: "offline",
        proofUrl,
        status: "pending",
      };
      await addDoc(collection(db, "paymentProofs"), payload);
      setProofMessage("Comprobante enviado. Revisaremos tu pago en breve.");
      setUserMeta((prev) => ({ ...prev, status: prev.status || "pending" }));
    } catch (err) {
      console.error("Error enviando comprobante:", err);
      setProofMessage("No se pudo enviar el comprobante. Inténtalo nuevamente.");
    } finally {
      setProofSubmitting(false);
      setShowUploadModal(false);
      setProofFile(null);
      setProofNote("");
    }
  };

  const handleAdminProofAction = async (proof, action) => {
    if (!isAdmin || !user) return;
    setAdminActionStatus((prev) => ({ ...prev, [proof.id]: action }));
    try {
      const now = new Date().toISOString();
      const proofRef = doc(db, "paymentProofs", proof.id);
      if (action === "approved") {
        const batch = writeBatch(db);
        const userRef = doc(db, "users", proof.uid);
        batch.set(
          userRef,
          {
            isPaid: true,
            status: "approved",
            approvedAt: now,
          },
          { merge: true }
        );
        batch.update(proofRef, {
          status: "approved",
          reviewedAt: now,
          reviewerUid: user.uid,
        });
        await batch.commit();
        showMessage("Suscripción activada");
      } else {
        await updateDoc(proofRef, {
          status: "rejected",
          reviewedAt: now,
          reviewerUid: user.uid,
        });
        showMessage("Comprobante rechazado");
      }
    } catch (err) {
      console.error("Error actualizando comprobante:", err);
      showMessage("No se pudo actualizar el comprobante");
    } finally {
      setAdminActionStatus((prev) => {
        const next = { ...prev };
        delete next[proof.id];
        return next;
      });
    }
  };

  const handleApproveProof = (proof) => handleAdminProofAction(proof, "approved");
  const handleRejectProof = (proof) => handleAdminProofAction(proof, "rejected");

  const handleCheckout = () => {
    window.open("https://www.mercadopago.com.pe/checkout", "_blank", "noopener");
  };

  // Persistencia de sesión: rehidratar (si el usuario ya estaba logueado)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        const storedName = localStorage.getItem(`planifica_name_${u.uid}`) || "";
        setName(storedName);
        setNameCommitted(!!storedName);
        resetFormFields();
        hydrateFormDraft(u.uid);
        fetchUserMeta(u.uid);
      } else {
        setUser(null);
        setName("");
        setNameCommitted(false);
        resetFormFields();
        setUserMeta({ isPaid: false, status: "" });
        setMetaLoading(false);
        setProofMessage("");
        setShowUploadModal(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const payload = {
      formTipo,
      formCategoria,
      formMonto,
      formDescripcion,
    };
    try {
      localStorage.setItem(`planifica_form_${user.uid}`, JSON.stringify(payload));
    } catch {}
  }, [user, formTipo, formCategoria, formMonto, formDescripcion]);

  // Firestore realtime subscription: when user changes, subscribe to their records
  useEffect(() => {
    if (!user) {
      setRecords([]);
      return;
    }
    const coll = collection(db, "records");
    // query records for this user, ordered by fecha ascending
    const q = query(coll, where("uid", "==", user.uid), orderBy("fecha", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => {
          arr.push({ id: d.id, ...d.data() });
        });
        // Ensure monto numeric & keep order
        setRecords(arr.map((r) => ({ ...r, monto: Number(r.monto || 0) })));
      },
      (err) => {
        console.error("Firestore onSnapshot error:", err);
      }
    );
    return () => unsub();
  }, [user]);

  // Auth handlers
  const handleLogin = async (e) => {
    e?.preventDefault();
    try {
      // Configurar persistencia según "Recuérdame"
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      const u = await signInWithEmailAndPassword(auth, email, password);
      setMetaLoading(true);
      setUser(u.user);
      setLoginError("");

      // Guardar preferencia/email si recuerdame
      if (rememberMe) {
        localStorage.setItem("planifica_remember", "1");
        localStorage.setItem("planifica_email", email);
      } else {
        localStorage.removeItem("planifica_remember");
        localStorage.removeItem("planifica_email");
      }

      // Mostrar splash 3s
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 3000);
      // no tocamos name/nameCommitted aquí (puede que ya lo tengan)
    } catch (err) {
      setLoginError("Usuario o contraseña incorrectos");
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const result = await signInWithPopup(auth, googleProvider);
      setMetaLoading(true);
      setUser(result.user);
      setLoginError("");
      setShowSplash(true);
      setTimeout(() => setShowSplash(false), 3000);
    } catch (err) {
      console.error("Google login error:", err);
      setLoginError("No se pudo iniciar sesión con Google.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
    setEmail(rememberMe ? localStorage.getItem("planifica_email") || "" : "");
    setPassword("");
    setUserMeta({ isPaid: false, status: "" });
    setProofMessage("");
    setShowUploadModal(false);
    setProofFile(null);
    setProofNote("");
    // mantenemos rememberMe tal como lo dejó el usuario
  };

const handleRegisterToggle = () => {
  setRegisterMode((prev) => !prev);
  if (!registerMode) {
    setRegisterName("");
    setRegisterEmail("");
    setRegisterPassword("");
  }
  setRegisterError("");
  setRegisterMessage("");
};

const handleRegister = async (e) => {
  e?.preventDefault();
  if (!registerName.trim() || !registerEmail.trim() || !registerPassword.trim()) {
    setRegisterError("Completa tu nombre, correo real y contraseña.");
    return;
  }
  setRegisterLoading(true);
  setRegisterError("");
  setRegisterMessage("");
  try {
    const cred = await createUserWithEmailAndPassword(auth, registerEmail.trim(), registerPassword);
    const createdUser = cred.user;
    localStorage.setItem(`planifica_name_${createdUser.uid}`, registerName.trim());
    setName(registerName.trim());
    setNameCommitted(true);
    setEmail(registerEmail.trim());
    setRegisterMessage("Cuenta creada. Revisa la sección de pagos para activar tu suscripción.");
    setRegisterMode(false);
    setRegisterName("");
    setRegisterPassword("");
  } catch (err) {
    setRegisterError(err.message || "No se pudo crear la cuenta.");
  } finally {
    setRegisterLoading(false);
  }
};

const handleSaveProfileName = () => {
  if (!user) return;
  const trimmed = (tempProfileName || "").trim();
  if (!trimmed) return;
  localStorage.setItem(`planifica_name_${user.uid}`, trimmed);
  setName(trimmed);
  setNameCommitted(true);
  setEditingProfileName(false);
  showMessage("Nombre actualizado");
};

const handleStartEditProfileName = () => {
  setEditingProfileName(true);
  setTempProfileName(name || "");
};

const handleCancelProfileEdit = () => {
  setEditingProfileName(false);
  setTempProfileName(name || "");
};
  // Guardar record -> Firestore write relies on snapshot to update UI
  const handleSaveRecord = async (e) => {
    e?.preventDefault();
    if (savingRecord) return;
    if (!user) {
      showMessage("Inicia sesión antes de registrar.", 2400);
      return;
    }
    if (!formTipo || !formCategoria || !formMonto) {
      showMessage("Completa tipo, categoria y monto", 2400);
      return;
    }

    const docBody = {
      uid: user.uid,
      tipo: formTipo,
      categoria: formCategoria,
      monto: Number(formMonto),
      fecha: new Date().toISOString(),
      descripcion: formDescripcion || "",
      voucher: formVoucher ? { name: formVoucher.name, url: URL.createObjectURL(formVoucher) } : null,
    };

    try {
      setSavingRecord(true);
      await addDoc(collection(db, "records"), docBody);
      resetFormFields();
      showMessage("Registro agregado");
    } catch (err) {
      console.error("Error guardando en Firestore:", err);
      showMessage("No se pudo guardar el registro. Inténtalo nuevamente.", 2800);
    } finally {
      setSavingRecord(false);
    }
  };

  // derived
  const gastos = useMemo(() => records.filter((r) => r.tipo === "gasto"), [records]);
  const ingresos = useMemo(() => records.filter((r) => r.tipo === "ingreso"), [records]);

  const monthKeys = useMemo(() => {
    const set = new Set(records.map((r) => monthKeyFromDate(r.fecha)));
    const arr = Array.from(set).sort((a, b) => new Date(a + "-01") - new Date(b + "-01"));
    return arr;
  }, [records]);

  const totalsByMonth = useMemo(() => {
    const map = {};
    monthKeys.forEach((k) => (map[k] = { gastos: 0, ingresos: 0, items: { gastos: [], ingresos: [] } }));
    records.forEach((r) => {
      const k = monthKeyFromDate(r.fecha);
      if (!map[k]) map[k] = { gastos: 0, ingresos: 0, items: { gastos: [], ingresos: [] } };
      if (r.tipo === "gasto") {
        map[k].gastos += Number(r.monto || 0);
        map[k].items.gastos.push(r);
      } else {
        map[k].ingresos += Number(r.monto || 0);
        map[k].items.ingresos.push(r);
      }
    });
    let running = 0;
    monthKeys.forEach((k) => {
      const net = (map[k].ingresos || 0) - (map[k].gastos || 0);
      running += net;
      map[k].net = net;
      map[k].cumulative = running; // carryover effect
    });
    return map;
  }, [records, monthKeys]);

  // charts data
  const chartLineData = useMemo(() => {
    const labels = monthKeys.map((k) => monthLabel(k));
    const gastosData = monthKeys.map((k) => totalsByMonth[k]?.gastos || 0);
    const ingresosData = monthKeys.map((k) => totalsByMonth[k]?.ingresos || 0);
    return {
      labels,
      datasets: [
        { label: "Gastos", data: gastosData, borderColor: "rgba(239,68,68,0.9)", backgroundColor: "rgba(239,68,68,0.08)", tension: 0.3 },
        { label: "Ingresos", data: ingresosData, borderColor: "rgba(34,197,94,0.9)", backgroundColor: "rgba(34,197,94,0.08)", tension: 0.3 },
      ],
    };
  }, [monthKeys, totalsByMonth]);

  const pieGastos = useMemo(() => {
    const catTotals = {};
    gastos.forEach((g) => (catTotals[g.categoria] = (catTotals[g.categoria] || 0) + Number(g.monto || 0)));
    const labels = Object.keys(catTotals);
    const data = labels.map((l) => catTotals[l]);
    return { labels, datasets: [{ data, backgroundColor: ["#2563eb", "rgba(55, 143, 163, 1)", "#1b9a41ff", "#d2c926ff", "#a78bfa", "#f472b6"].slice(0, labels.length) }] };
  }, [gastos]);

  const pieIngresos = useMemo(() => {
    const catTotals = {};
    ingresos.forEach((g) => (catTotals[g.categoria] = (catTotals[g.categoria] || 0) + Number(g.monto || 0)));
    const labels = Object.keys(catTotals);
    const data = labels.map((l) => catTotals[l]);
    return { labels, datasets: [{ data, backgroundColor: ["#16a34a", "#30d5d8ff", "#6971e0ff", "#c36becff", "#c01766ff"].slice(0, labels.length) }] };
  }, [ingresos]);


  // bar chart for current month spending by category (real-time)
  const barThisMonth = useMemo(() => {
    const nowKey = monthKeyFromDate(new Date());
    const thisMonthsGastos = totalsByMonth[nowKey]?.items?.gastos || [];
    const catTotals = {};
    thisMonthsGastos.forEach((g) => (catTotals[g.categoria] = (catTotals[g.categoria] || 0) + Number(g.monto || 0)));
    const labels = Object.keys(catTotals);
    const data = labels.map((l) => catTotals[l]);
    return { labels, datasets: [{ data, backgroundColor: ["#ef4444", "#fb7185", "#f97316", "#f59e0b", "#fbbf24"].slice(0, labels.length) }] };
  }, [totalsByMonth]);

  // deleteRecord updated to also attempt Firestore deletion
  const deleteRecord = async (id) => {
    setRecords((r) => r.filter((x) => x.id !== id));
    try {
      await deleteDoc(doc(db, "records", id));
    } catch (err) {
      // ignore if firestore doc not found — local still updated
      // console.warn(err);
    }
  };

  /* ---------- Spanish file input UI helpers ---------- */
  const handleFileSelect = (file) => {
    if (!file) {
      setFormVoucher(null);
      return;
    }
    setFormVoucher(file);
  };

  /* ---------- Inline edit state for Estado de Resultados ---------- */
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ categoria: "", monto: "", descripcion: "" });

  const startEdit = (record) => {
    setEditingId(record.id);
    setEditForm({ categoria: record.categoria || "", monto: record.monto || "", descripcion: record.descripcion || "" });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ categoria: "", monto: "", descripcion: "" });
  };
  const saveEdit = async (id) => {
    setRecords((r) => r.map((it) => (it.id === id ? { ...it, categoria: editForm.categoria, monto: Number(editForm.monto || 0), descripcion: editForm.descripcion } : it)));
    try {
      const ref = doc(db, "records", id);
      await updateDoc(ref, { categoria: editForm.categoria, monto: Number(editForm.monto || 0), descripcion: editForm.descripcion });
    } catch (err) {
      // ignore if no firestore doc
    }
    cancelEdit();
  };

  /* ---------- Pantallas por estado (login -> splash -> nombre -> saludo/acciones) ---------- */

    // 1) LOGIN
  if (!user) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div className="header">
          <h1>Planifica+</h1>
          <p>Visualiza tus indicadores financieros en tiempo real</p>
        </div>

        <form
          onSubmit={handleLogin}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            background: "white",
            padding: "1.5rem",
            borderRadius: "12px",
            boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
            width: "100%",
            maxWidth: "420px",
            marginBottom: "1rem",
          }}
        >
          <input
            type="email"
            placeholder="Correo electr�nico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />
          <input
            type="password"
            placeholder="Contrase�a"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: "0.6rem", borderRadius: "8px", border: "1px solid #cbd5e1" }}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#334155" }}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Recu�rdame
          </label>

          {loginError && <div style={{ color: "red" }}>{loginError}</div>}
          <button type="submit">Iniciar sesi�n</button>
          <button
            type="button"
            onClick={handleGoogleLogin}
            style={{ background: "#db4437" }}
          >
            Continuar con Google
          </button>
          <button
            type="button"
            onClick={() => setShowForgotHelp((prev) => !prev)}
            style={{ background: "#f8fafc", color: "#0f172a" }}
          >
            �Olvidaste tu contrase�a?
          </button>
          {showForgotHelp && (
            <div style={{ fontSize: 13, color: "#475569" }}>
              Escr�benos por WhatsApp al{" "}
              <a href={supportWhatsAppLink} style={{ color: "#1d4ed8", fontWeight: 600 }} target="_blank" rel="noreferrer">
                +51 937 698 884
              </a>{" "}
              y te ayudaremos a restablecerla.
            </div>
          )}
        </form>
        <div style={{ marginTop: 12, fontSize: 14, color: "#475569" }}>
          �No tienes una cuenta?{" "}
          <button
            type="button"
            onClick={handleRegisterToggle}
            style={{ color: "#1d4ed8", textDecoration: "underline", background: "transparent" }}
          >
            Reg�strate aqu�
          </button>
        </div>
        {registerMode && (
          <form
            onSubmit={handleRegister}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              background: "white",
              padding: "1.5rem",
              borderRadius: "12px",
              boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
              width: "100%",
              maxWidth: "420px",
              marginTop: "1.5rem",
            }}
          >
            <h3 style={{ marginBottom: 8 }}>Crear cuenta</h3>
            <input
              type="text"
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              placeholder="Nombre completo"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <input
              type="email"
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              placeholder="Correo electr�nico real"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <input
              type="password"
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              placeholder="Contrase�a"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <div style={{ fontSize: 13, color: "#475569" }}>
              Usa un correo real y luego activa tu suscripci�n para ingresar.
            </div>
            {registerError && <div style={{ color: "#ef4444", fontSize: 14 }}>{registerError}</div>}
            {registerMessage && <div style={{ color: "#16a34a", fontSize: 14 }}>{registerMessage}</div>}
            <button type="submit" disabled={registerLoading}>
              {registerLoading ? "Creando..." : "Registrarme"}
            </button>
          </form>
        )}
      </div>
    );
  }// 2) SPLASH (3s)
  if (showSplash) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div
          style={{
            background: "white",
            padding: "1.25rem 1.4rem",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
            width: "100%",
            maxWidth: 520,
            textAlign: "center",
            animation: "fadeIn 0.35s ease",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0f172a" }}>Recuerda que eres lo que planificas 💚</div>
        </div>
      </div>
    );
  }

  const shouldShowPaywall = user && !isAdmin && !userMeta.isPaid;

  if (user && metaLoading) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div
          style={{
            background: "white",
            padding: "1.25rem 1.4rem",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
            width: "100%",
            maxWidth: 520,
            textAlign: "center",
          }}
        >
          Cargando estado de suscripción...
        </div>
      </div>
    );
  }

  if (shouldShowPaywall) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div
          style={{
            background: "white",
            padding: "1.5rem",
            borderRadius: 12,
            boxShadow: "0 8px 20px rgba(0,0,0,0.05)",
            width: "100%",
            maxWidth: 560,
          }}
        >
          <h2>Activa tu suscripción</h2>
          <p style={{ marginTop: 8, color: "#475569" }}>
            Accede a tus reportes pagando con tarjeta (Mercado Pago) o con transferencia, Yape/Plin o efectivo.
          </p>

          <div style={{ marginTop: 16, padding: 12, border: "1px solid #e2e8f0", borderRadius: 10 }}>
            <h3 style={{ marginBottom: 6 }}>Pago con tarjeta</h3>
            <p style={{ fontSize: 14, color: "#475569" }}>
              Usa Mercado Pago para pagar con tarjeta de crédito o débito.
            </p>
            <button type="button" onClick={handleCheckout} style={{ marginTop: 8, width: "100%" }}>
              Pagar con Mercado Pago
            </button>
          </div>

          <div style={{ marginTop: 16, padding: 12, border: "1px solid #e2e8f0", borderRadius: 10 }}>
            <h3 style={{ marginBottom: 6 }}>Pago por transferencia / Yape / efectivo</h3>
            <ul style={{ margin: "8px 0 0 20px", color: "#475569" }}>
              <li>BCP: 123-4567890</li>
              <li>Yape / Plin: +51 999 999 999</li>
              <li>Oficina: Av. Siempre Viva 123, Lima</li>
            </ul>
            <p style={{ marginTop: 8, fontSize: 14, color: "#64748b" }}>
              Envíanos el comprobante para activar tu cuenta.
            </p>
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              style={{ marginTop: 8, width: "100%" }}
            >
              Enviar comprobante
            </button>
          </div>

          {proofMessage && (
            <div style={{ marginTop: 12, color: "#2563eb" }}>{proofMessage}</div>
          )}

          {userMeta.status === "pending" && (
            <div style={{ marginTop: 12, color: "#2563eb" }}>
              Gracias, estamos verificando tu pago.
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            style={{ marginTop: 16, background: "#f1f5f9", color: "#0f172a" }}
          >
            Cerrar sesión
          </button>
        </div>

        {showUploadModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                background: "white",
                padding: 20,
                borderRadius: 12,
                width: "100%",
                maxWidth: 420,
                boxShadow: "0 12px 28px rgba(0,0,0,0.12)",
              }}
            >
              <h4>Enviar comprobante</h4>
              <p style={{ fontSize: 14, color: "#475569" }}>Adjunta la imagen o deja una nota.</p>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleProofFileChange(e.target.files?.[0] || null)}
                style={{ marginTop: 12 }}
              />
              <textarea
                rows={3}
                placeholder="Nota opcional"
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                style={{ width: "100%", marginTop: 10, padding: 8, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={submitPaymentProof}
                  disabled={proofSubmitting}
                  style={{ flex: 1 }}
                >
                  {proofSubmitting ? "Enviando..." : "Enviar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false);
                    setProofFile(null);
                    setProofNote("");
                  }}
                  style={{ flex: 1, background: "#f1f5f9", color: "#0f172a" }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (user && metaLoading) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div
          style={{
            background: "white",
            padding: "1.25rem 1.4rem",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
            width: "100%",
            maxWidth: 520,
            textAlign: "center",
          }}
        >
          Cargando tu estado de suscripción...
        </div>
      </div>
    );
  }

  if (shouldShowPaywall) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div
          style={{
            background: "white",
            padding: "1.5rem",
            borderRadius: 12,
            boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
            width: "100%",
            maxWidth: 520,
          }}
        >
          <h2>Activa tu suscripción</h2>
          <p style={{ marginTop: 8, color: "#475569" }}>
            Accede a los reportes y registros en tiempo real realizando tu pago por transferencia, Yape/Plin o efectivo.
          </p>

          <div style={{ marginTop: 16, padding: 12, border: "1px solid #e2e8f0", borderRadius: 10 }}>
            <h3 style={{ marginBottom: 6 }}>Pago por transferencia o efectivo</h3>
            <ul style={{ margin: "8px 0 0 20px", color: "#475569" }}>
              <li>BCP: 123-4567890</li>
              <li>Yape / Plin: +51 999 999 999</li>
              <li>Oficina: Av. Siempre Viva 123, Lima</li>
            </ul>
            <p style={{ marginTop: 8, fontSize: 14, color: "#64748b" }}>
              Envíanos el comprobante desde el botón inferior para validar tu suscripción.
            </p>
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              style={{ marginTop: 8, width: "100%" }}
            >
              Enviar comprobante
            </button>
          </div>

          {proofMessage && (
            <div style={{ marginTop: 12, color: "#2563eb" }}>{proofMessage}</div>
          )}

          {userMeta.status === "pending" && (
            <div style={{ marginTop: 12, color: "#2563eb" }}>
              Gracias, estamos verificando tu pago.
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            style={{ marginTop: 16, background: "#e2e8f0", color: "#0f172a" }}
          >
            Cerrar sesión
          </button>
        </div>

        {showUploadModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              padding: 20,
            }}
          >
            <div style={{ background: "white", padding: 20, borderRadius: 12, width: "100%", maxWidth: 420, boxShadow: "0 12px 28px rgba(0,0,0,0.12)" }}>
              <h4>Enviar comprobante</h4>
              <p style={{ fontSize: 14, color: "#475569" }}>Adjunta una foto o deja instrucciones.</p>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => handleProofFileChange(e.target.files?.[0] || null)}
                style={{ marginTop: 12 }}
              />
              <textarea
                rows={3}
                placeholder="Nota opcional"
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                style={{ width: "100%", marginTop: 10, padding: 8, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={submitPaymentProof}
                  disabled={proofSubmitting}
                  style={{ flex: 1 }}
                >
                  {proofSubmitting ? "Enviando..." : "Enviar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadModal(false);
                    setProofFile(null);
                    setProofNote("");
                  }}
                  style={{ flex: 1, background: "#f1f5f9", color: "#0f172a" }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3) PEDIR NOMBRE (si no existe aún)
  if (!nameCommitted) {
    return (
      <div className="container" style={{ paddingBottom: 140 }}>
        <div className="header">
          <h1>Planifica+</h1>
          <p>Visualiza tus indicadores financieros en tiempo real</p>
        </div>

        <div
          style={{
            background: "white",
            padding: "1.25rem 1.4rem",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
            width: "100%",
            maxWidth: 520,
            animation: "fadeIn 0.35s ease",
          }}
        >
          <label style={{ display: "block", marginBottom: 8, color: "#475569", fontSize: 14 }}>
            ¿Cuál es tu nombre?
          </label>
          <input
            type="text"
            placeholder="Escribe tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 10 }}
          />
          <button
            onClick={() => {
              const trimmed = (name || "").trim();
              if (!trimmed || !user) return;
              localStorage.setItem(`planifica_name_${user.uid}`, trimmed);
              setNameCommitted(true);
            }}
            style={{ width: "100%" }}
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  const renderAdminPanel = () => {
    if (!isAdmin) return null;
    return (
      <div
        style={{
          background: "white",
          padding: "1rem",
          borderRadius: 12,
          boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
          width: "100%",
          maxWidth: 920,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Panel de comprobantes</div>
        {adminProofsLoading ? (
          <div style={{ color: "#475569" }}>Cargando comprobantes pendientes...</div>
        ) : adminProofs.length === 0 ? (
          <div style={{ color: "#475569" }}>No hay comprobantes pendientes.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {adminProofs.map((proof) => {
              const createdDate = proof.createdAt ? new Date(proof.createdAt) : null;
              const busy = !!adminActionStatus[proof.id];
              return (
                <div
                  key={proof.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>UID: {proof.uid}</div>
                  {proof.fileName && <div style={{ color: "#475569" }}>Archivo: {proof.fileName}</div>}
                  {proof.note && <div style={{ color: "#475569" }}>Nota: {proof.note}</div>}
                  <div style={{ color: "#475569" }}>
                    Recibido: {createdDate ? createdDate.toLocaleString("es-PE") : "Sin fecha"}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {proof.proofUrl && (
                      <a
                        href={proof.proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#2563eb", fontWeight: 600 }}
                      >
                        Ver comprobante
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApproveProof(proof)}
                      disabled={busy}
                      style={{ background: "#22c55e", color: "#fff", padding: "6px 10px", borderRadius: 8 }}
                    >
                      {busy && adminActionStatus[proof.id] === "approved" ? "Aprobando..." : "Aprobar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRejectProof(proof)}
                      disabled={busy}
                      style={{ background: "#f97316", color: "#fff", padding: "6px 10px", borderRadius: 8 }}
                    >
                      {busy && adminActionStatus[proof.id] === "rejected" ? "Rechazando..." : "Rechazar"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /* ---------- JSX principal (saludo + acciones + tabs) ---------- */
  return (
    <div className="container" style={{ paddingBottom: 140 }}>
      {/* Header */}
      <div className="header">
        <h1>Planifica+</h1>
        <p>Visualiza tus indicadores financieros en tiempo real</p>
      </div>

      {/* Greeting + action buttons */}
      <div
        style={{
          background: "white",
          padding: "1rem",
          borderRadius: 12,
          boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
          width: "100%",
          maxWidth: 920,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          ¡Hola, {name || "usuario"}! ¿Qué te gustaría hacer?
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setTab("registro")} style={{ padding: "10px 14px", borderRadius: 10 }}>
            Registrar gasto/ingreso
          </button>
          <button onClick={() => setTab("estado")} style={{ padding: "10px 14px", borderRadius: 10 }}>
            Estado de resultados
          </button>
          <button onClick={() => setTab("analisis")} style={{ padding: "10px 14px", borderRadius: 10 }}>
            Mira tus gráficos
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {user && (
              <button
                type="button"
                onClick={() => setTab("perfil")}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  border: "1px solid #93c5fd",
                  background: tab === "perfil" ? "#1d4ed8" : "#fff",
                  color: tab === "perfil" ? "#fff" : "#1d4ed8",
                  fontWeight: 600,
                  boxShadow: "0 4px 12px rgba(29,78,216,0.18)",
                }}
              >
                Mi perfil
              </button>
            )}
            <button onClick={handleLogout} style={{ background: "#ef4444" }}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      {renderAdminPanel()}

      {/* Tabs content */}
      <div style={{ width: "100%", maxWidth: 1200 }}>
        {tab === "perfil" && user && (
          <div
            style={{
              background: "white",
              padding: 20,
              borderRadius: 12,
              boxShadow: "0 8px 22px rgba(0,0,0,0.05)",
              marginBottom: 16,
            }}
          >
            <h3 style={{ marginBottom: 8 }}>Tu perfil</h3>
            <p style={{ marginBottom: 16, color: "#475569" }}>
              Administra tu nombre y canales de contacto.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ color: "#475569" }}>
                <div style={{ fontWeight: 600 }}>Nombre guardado</div>
                {editingProfileName ? (
                  <>
                    <input
                      type="text"
                      value={tempProfileName}
                      onChange={(e) => setTempProfileName(e.target.value)}
                      style={{ width: "100%", marginTop: 6, padding: 8, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button type="button" onClick={handleSaveProfileName} style={{ flex: 1 }}>
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelProfileEdit}
                        style={{ flex: 1, background: "#f1f5f9", color: "#0f172a" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{name || "Sin nombre"}</span>
                    <button type="button" onClick={handleStartEditProfileName} style={{ padding: "6px 10px" }}>
                      Editar nombre
                    </button>
                  </div>
                )}
              </div>
              <div style={{ color: "#475569" }}>
                <div style={{ fontWeight: 600 }}>Correo</div>
                <div style={{ marginTop: 6 }}>{user.email}</div>
              </div>
              <div style={{ color: "#475569" }}>
                <div style={{ fontWeight: 600 }}>Soporte</div>
                <div style={{ marginTop: 6 }}>¿Necesitas ayuda? Escríbenos por WhatsApp.</div>
                <a
                  href={supportWhatsAppLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", marginTop: 8, color: "#1d4ed8", fontWeight: 600 }}
                >
                  Contactar soporte
                </a>
              </div>
            </div>
          </div>
        )}
        {/* Registro Tab */}
        {tab === "registro" && (
          <div style={{ background: "white", padding: 16, borderRadius: 12, boxShadow: "0 8px 20px rgba(0,0,0,0.05)" }}>
            <h3 style={{ marginBottom: 12 }}>Registrar gasto / ingreso</h3>
            <form key={formKey} onSubmit={handleSaveRecord} style={{ display: "grid", gap: 10 }}>
              {/* Tipo */}
              <select
                value={formTipo}
                onChange={(e) => {
                  setFormTipo(e.target.value);
                  setFormCategoria("");
                }}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                required
              >
                <option value="">{/* watermark */}Registra gasto/ingreso</option>
                <option value="gasto">Gasto</option>
                <option value="ingreso">Ingreso</option>
              </select>

              {/* Categoria - dynamic */}
              <select
                value={formCategoria}
                onChange={(e) => setFormCategoria(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                required
              >
                <option value="">{/* watermark */}Escoja la categoría</option>
                {(formTipo === "ingreso" ? ingresoCats : formTipo === "gasto" ? gastoCats : [...gastoCats, ...ingresoCats]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {/* Monto */}
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Monto S/."
                value={formMonto}
                onChange={(e) => setFormMonto(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
                required
              />

              {/* Voucher - botón funcional en español */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => voucherInputRef.current && voucherInputRef.current.click()}
                  style={{ padding: "8px 12px", borderRadius: 8 }}
                >
                  📎 Adjuntar voucher o recibo
                </button>
                <div style={{ color: "#64748b", fontSize: 14 }}>
                  {formVoucher ? formVoucher.name : "Ningún archivo seleccionado"}
                </div>
                <input
                  ref={voucherInputRef}
                  id="voucher-input"
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    handleFileSelect(f);
                  }}
                />
              </div>

              {/* Descripcion */}
              <input
                type="text"
                placeholder="Descripción"
                value={formDescripcion}
                onChange={(e) => setFormDescripcion(e.target.value)}
                style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" style={{ flex: 1 }} disabled={savingRecord}>
                  {savingRecord ? "Guardando..." : "Gana / Pierde"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormTipo("");
                    setFormCategoria("");
                    setFormMonto("");
                    setFormVoucher(null);
                    setFormDescripcion("");
                    if (voucherInputRef.current) {voucherInputRef.current.value = "";

                    }
                    // fuerza reinicio total del form
                    setFormKey((k) => k + 1);
                  }}
                  style={{ flex: 1, background: "#f1f5f9", color: "#0f172a" }}
                  >
                  Limpiar
                  </button>
                  </div>
                  {message && <div style={{ color: "green" }}>{message}</div>}
                  </form>
                   </div>
        )}

        {/* Estado de Resultados */}
        {tab === "estado" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ background: "white", borderRadius: 12, padding: 12, boxShadow: "0 8px 20px rgba(0,0,0,0.04)" }}>
              <h3>Estado de Resultados</h3>

              {monthKeys.length === 0 ? (
                <p>Aún no hay registros.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20,
 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e6edf3", width: 360 }}>Concepto</th>
                        {monthKeys.map((k) => (
                          <th key={k} style={{ padding: 10, borderBottom: "1px solid #e6edf3", textAlign: "right", whiteSpace: "nowrap" }}>{monthLabel(k)}</th>
                        ))}
                        <th style={{ padding: 10, borderBottom: "1px solid #e6edf3", textAlign: "right" }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* INGRESOS header row */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700, color: "#16a34a" }}>INGRESOS</td>
                        {monthKeys.map((k) => (
                          <td key={k} style={{ padding: 10, textAlign: "right", verticalAlign: "top" }}>
                            {formatCurrency(totalsByMonth[k]?.ingresos || 0)}
                          </td>
                        ))}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>
                          {formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.ingresos || 0), 0))}
                        </td>
                      </tr>

                      {/* List each ingreso as its own row */}
                      {ingresos.map((it) => {
                        const rowTotal = monthKeys.reduce((acc, k) => acc + (monthKeyFromDate(it.fecha) === k ? Number(it.monto || 0) : 0), 0);
                        return (
                          <tr key={it.id} style={{ background: "#ffffff" }}>
                            <td style={{ padding: 8, borderBottom: "1px dashed #e6edf3", textAlign: "left" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{it.categoria} {it.descripcion ? `— ${it.descripcion}` : ""}</div>
                                  {it.voucher && (
                                    <div style={{ fontSize: 13, color: "#2563eb" }}>
                                      <a href={it.voucher.url} target="_blank" rel="noreferrer">📎 {it.voucher.name}</a>
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  {editingId === it.id ? (
                                    <>
                                      <button onClick={() => saveEdit(it.id)} style={{ background: "#16a34a", color: "#fff", borderRadius: 6, padding: "6px 8px" }}>Guardar</button>
                                      <button onClick={cancelEdit} style={{ background: "#f1f5f9", borderRadius: 6, padding: "6px 8px" }}>Cancelar</button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => startEdit(it)}
                                        onKeyDown={(e) => e.preventDefault()}
                                        style={{ background: "#16a34a", color: "#fff", borderRadius: 6, padding: "6px 8px" }}
                                      >
                                        Editar
                                      </button>
                                      <button onClick={() => deleteRecord(it.id)} style={{ background: "#ef4444", color: "#fff", borderRadius: 6, padding: "6px 8px" }}>Eliminar</button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {editingId === it.id && (
                                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                  <input value={editForm.categoria} onChange={(e) => setEditForm((s) => ({ ...s, categoria: e.target.value }))} style={{ padding: 6, borderRadius: 6 }} />
                                  <input type="number" value={editForm.monto} onChange={(e) => setEditForm((s) => ({ ...s, monto: e.target.value }))} style={{ padding: 6, borderRadius: 6, width: 120 }} />
                                  <input value={editForm.descripcion} onChange={(e) => setEditForm((s) => ({ ...s, descripcion: e.target.value }))} style={{ padding: 6, borderRadius: 6 }} />
                                </div>
                              )}
                            </td>

                            {monthKeys.map((k) => (
                              <td key={k} style={{ padding: 8, borderBottom: "1px dashed #e6edf3", textAlign: "right", verticalAlign: "top" }}>
                                {monthKeyFromDate(it.fecha) === k ? formatCurrency(it.monto) : ""}
                              </td>
                            ))}

                            <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>{formatCurrency(rowTotal)}</td>
                          </tr>
                        );
                      })}

                      {/* Total Ingresos row (explicit) */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700 }}>Total Ingresos</td>
                        {monthKeys.map((k) => (
                          <td key={k} style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(totalsByMonth[k]?.ingresos || 0)}</td>
                        ))}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.ingresos || 0), 0))}</td>
                      </tr>

                      {/* EGRESOS header row */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700, color: "#ef4444" }}>EGRESOS</td>
                        {monthKeys.map((k) => (
                          <td key={k} style={{ padding: 10, textAlign: "right" }}>{formatCurrency(totalsByMonth[k]?.gastos || 0)}</td>
                        ))}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.gastos || 0), 0))}</td>
                      </tr>

                      {/* List each gasto as its own row */}
                      {gastos.map((it) => {
                        const rowTotal = monthKeys.reduce((acc, k) => acc + (monthKeyFromDate(it.fecha) === k ? Number(it.monto || 0) : 0), 0);
                        return (
                          <tr key={it.id}>
                            <td style={{ padding: 8, borderBottom: "1px dashed #e6edf3", textAlign: "left" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div>
                                  <div style={{ fontWeight: 600 }}>{it.categoria} {it.descripcion ? `— ${it.descripcion}` : ""}</div>
                                  {it.voucher && (
                                    <div style={{ fontSize: 13, color: "#2563eb" }}>
                                      <a href={it.voucher.url} target="_blank" rel="noreferrer">📎 {it.voucher.name}</a>
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  {editingId === it.id ? (
                                    <>
                                      <button onClick={() => saveEdit(it.id)} style={{ background: "#16a34a", color: "#fff", borderRadius: 6, padding: "6px 8px" }}>Guardar</button>
                                      <button onClick={cancelEdit} style={{ background: "#f1f5f9", borderRadius: 6, padding: "6px 8px" }}>Cancelar</button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => startEdit(it)}
                                        onKeyDown={(e) => e.preventDefault()}
                                        style={{ background: "#16a34a", color: "#fff", borderRadius: 6, padding: "6px 8px" }}
                                      >
                                        Editar
                                      </button>
                                      <button onClick={() => deleteRecord(it.id)} style={{ background: "#ef4444", color: "#fff", borderRadius: 6, padding: "6px 8px" }}>Eliminar</button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {editingId === it.id && (
                                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                                  <input value={editForm.categoria} onChange={(e) => setEditForm((s) => ({ ...s, categoria: e.target.value }))} style={{ padding: 6, borderRadius: 6 }} />
                                  <input type="number" value={editForm.monto} onChange={(e) => setEditForm((s) => ({ ...s, monto: e.target.value }))} style={{ padding: 6, borderRadius: 6, width: 120 }} />
                                  <input value={editForm.descripcion} onChange={(e) => setEditForm((s) => ({ ...s, descripcion: e.target.value }))} style={{ padding: 6, borderRadius: 6 }} />
                                </div>
                              )}
                            </td>

                            {monthKeys.map((k) => (
                              <td key={k} style={{ padding: 8, borderBottom: "1px dashed #e6edf3", textAlign: "right", verticalAlign: "top" }}>
                                {monthKeyFromDate(it.fecha) === k ? formatCurrency(it.monto) : ""}
                              </td>
                            ))}

                            <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>{formatCurrency(rowTotal)}</td>
                          </tr>
                        );
                      })}

                      {/* Total Gastos row */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700 }}>Total Gastos</td>
                        {monthKeys.map((k) => (
                          <td key={k} style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(totalsByMonth[k]?.gastos || 0)}</td>
                        ))}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.gastos || 0), 0))}</td>
                      </tr>

                      {/* Saldo a favor / en contra (Ingresos - Gastos) */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700 }}>Saldo a favor / en contra (Ingresos - Gastos)</td>
                        {monthKeys.map((k) => (
                          <td key={k} style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(totalsByMonth[k]?.net || 0)}</td>
                        ))}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700 }}>{formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.net || 0), 0))}</td>
                      </tr>

                      {/* Ganancias / Gastos personales: net + previous month's balance (we use cumulative computed earlier) */}
                      <tr>
                        <td style={{ padding: 10, fontWeight: 700 }}>Ganancias / Gastos personales (saldo + acumulado previo)</td>
                        {monthKeys.map((k, idx) => {
                          const val = totalsByMonth[k]?.cumulative || 0; // includes carryover behavior
                          return (
                            <td key={k} style={{ padding: 10, textAlign: "right", fontWeight: 700, color: val >= 0 ? "#16a34a" : "#ef4444" }}>{formatCurrency(val)}</td>
                          );
                        },)}
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 700, color: Object.values(totalsByMonth).reduce((a, b) => a + (b.cumulative || 0), 0) >= 0 ? "#16a34a" : "#ef4444" }}>
                          {formatCurrency(Object.values(totalsByMonth).reduce((a, b) => a + (b.cumulative || 0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analisis / Graficos */}
  {/* Analisis / Graficos */}
{tab === "analisis" && (
  <div style={{ marginTop: 12 }}>
    <div className="chart-container">

      {/* 1. Pie de Ingresos */}
      <div className="chart-box">
        <h3 style={{ marginBottom: 8 }}>Distribución de ingresos este mes (categorías)</h3>
        <Pie data={pieIngresos} />
      </div>

      {/* 2. Pie de Gastos */}
      <div className="chart-box">
        <h3 style={{ marginBottom: 8 }}>Distribución de gastos este mes (categorías)</h3>
        <Pie data={pieGastos} />
      </div>

      {/* 3. Bar vertical */}
      <div className="chart-box">
        <h3 style={{ marginBottom: 8 }}>Gasto actual del mes (categoría)</h3>
        {barThisMonth.labels && barThisMonth.labels.length > 0 ? (
          <Bar
            data={barThisMonth}
            options={{
              indexAxis: "x",
              scales: {
                y: {
                  ticks: { callback: (v) => `S/. ${v}` },
                },
              },
              plugins: { legend: { display: false } },
            }}
          />
        ) : (
          <div style={{ color: "#64748b" }}>No hay gastos en el mes actual.</div>
        )}
      </div>

      {/* 4. Tendencia mensual */}
      <div className="chart-box">
        <h3 style={{ marginBottom: 8 }}>Tendencia mensual</h3>
        <Line data={chartLineData} />
      </div>
    </div> {/* ← ESTE CIERRE FALTABA */}
  </div>
)}
      {/* Floating assistant - always available */}
      <AssistantFloating gastos={gastos} ingresos={ingresos} />
    </div>
    </div>
  );
}












