import { useState, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { EffectComposer, Bloom, Noise } from '@react-three/postprocessing';
import * as THREE from 'three';

// ------------------------------------------------------------------
// 3D SCENE COMPONENT
// ------------------------------------------------------------------
const SphereCluster = ({ activePage, overlayMode }) => {
  const groupRef = useRef();
  const meshRef = useRef(); 
  const timeRef = useRef(0);
  const speedRef = useRef(1);
  const rotSpeed = useRef({ x: 0, y: 0, z: 0 }); 

  const sharedGeometry = useMemo(() => new THREE.SphereGeometry(0.35, 32, 32), []);
  const sharedMaterial = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#0a0a0a"),
    metalness: 1,
    roughness: 0.1,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: new THREE.Color("#4a154b"),
    emissiveIntensity: 0.5
  }), []);

  const pilePositions = useMemo(() => {
    const positions = [];
    for (let i = 0; i < 27; i++) {
      let layerRadius, yPos;
      if (i < 16) { layerRadius = 2.4; yPos = -1.2; }
      else if (i < 24) { layerRadius = 1.3; yPos = -0.85; }
      else { layerRadius = 0.5; yPos = -0.5; }

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * layerRadius; 
      
      positions.push([
        Math.cos(angle) * dist,
        yPos + (Math.random() * 0.15 - 0.075),
        Math.sin(angle) * dist
      ]);
    }
    return positions;
  }, []);

  const currentPositions = useMemo(() => {
    return pilePositions.map(p => new THREE.Vector3(...p));
  }, [pilePositions]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    const targetSpeed = overlayMode !== 'none' ? 4.0 : 1.0;
    speedRef.current = THREE.MathUtils.lerp(speedRef.current, targetSpeed, 0.015);
    timeRef.current += delta * speedRef.current * 0.4;
    const t = timeRef.current;

    const targetEmissive = activePage === 'home' ? 0.05 : 0.2;
    sharedMaterial.emissiveIntensity = THREE.MathUtils.lerp(sharedMaterial.emissiveIntensity, targetEmissive, 0.1);

    if (activePage === 'home') {
      sharedMaterial.emissive.lerp(new THREE.Color("#4a154b"), 0.05); 
    } else {
      const hue = 0.85 + Math.sin(t * 0.5) * 0.25; 
      const prismatic = new THREE.Color().setHSL(hue % 1, 0.5, 0.6); 
      sharedMaterial.emissive.lerp(prismatic, 0.05);
    }

    let targetX = 0, targetY = 0, targetZ = 0;
    if (activePage === 'code') { targetX = 0.2; targetY = 0.4; }
    else if (activePage === 'design') { targetY = 0.15; targetZ = 0.1; }
    else if (activePage === 'music') { targetX = 0.2; targetY = 0.4; } 
    else if (activePage === 'shop') { targetY = 0.8; } 

    rotSpeed.current.x = THREE.MathUtils.lerp(rotSpeed.current.x, targetX, 0.025);
    rotSpeed.current.y = THREE.MathUtils.lerp(rotSpeed.current.y, targetY, 0.025);
    rotSpeed.current.z = THREE.MathUtils.lerp(rotSpeed.current.z, targetZ, 0.025);

    if (groupRef.current) {
      if (activePage === 'home' || activePage === 'shop') {
        let rx = groupRef.current.rotation.x % (Math.PI * 2);
        let rz = groupRef.current.rotation.z % (Math.PI * 2);
        if (rx > Math.PI) rx -= Math.PI * 2; else if (rx < -Math.PI) rx += Math.PI * 2;
        if (rz > Math.PI) rz -= Math.PI * 2; else if (rz < -Math.PI) rz += Math.PI * 2;

        groupRef.current.rotation.x = THREE.MathUtils.lerp(rx, 0, 0.025);
        groupRef.current.rotation.z = THREE.MathUtils.lerp(rz, 0, 0.025);
      } else {
        groupRef.current.rotation.x += rotSpeed.current.x * delta * speedRef.current;
        groupRef.current.rotation.z += rotSpeed.current.z * delta * speedRef.current;
      }
      groupRef.current.rotation.y += rotSpeed.current.y * delta * speedRef.current;
    }

    for (let i = 0; i < 27; i++) {
      let targetPos = new THREE.Vector3();

      if (activePage === 'home') {
        targetPos.set(pilePositions[i][0], pilePositions[i][1] + Math.sin(t * 2 + i) * 0.1, pilePositions[i][2]);
      } 
      else if (activePage === 'code') {
        const x = (i % 3) - 1; const y = Math.floor((i / 3) % 3) - 1; const z = Math.floor(i / 9) - 1;
        targetPos.set(x * 1.2, y * 1.2, z * 1.2);
      } 
      else if (activePage === 'design') {
        if (i < 3) {
          targetPos.set(Math.sin(t * 2 + i) * 0.2, Math.cos(t * 2.1 + i) * 0.2, Math.sin(t * 1.9 + i) * 0.2);
        } else {
          const electronIdx = i - 3; const ring = Math.floor(electronIdx / 8); 
          const offset = (electronIdx % 8) * (Math.PI / 4); 
          const angle = t * 2 + offset + (ring * Math.PI / 6); 
          const radius = 1.8; 
          
          if (ring === 0) targetPos.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0); 
          else if (ring === 1) targetPos.set(0, Math.cos(angle) * radius, Math.sin(angle) * radius); 
          else targetPos.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius); 
        }
      } 
      else if (activePage === 'music') {
        const row = Math.floor(i / 9); const col = i % 9; 
        const x = (col - 4) * 0.7; const z = (row - 1) * 0.7;
        const y = Math.sin(x * 1.5 + row * 0.8 - t * 3.5) * 1.2;
        targetPos.set(x, y, z);
      }
      else if (activePage === 'shop') {
        let y, r, sides, indexInLayer;
        if (i === 0) { y = 2.4; r = 0; sides = 1; indexInLayer = 0; } 
        else if (i <= 6) { y = 1.2; r = 1.0; sides = 6; indexInLayer = i - 1; } 
        else if (i <= 19) { y = 0; r = 1.8; sides = 13; indexInLayer = i - 7; } 
        else if (i <= 25) { y = -1.2; r = 1.0; sides = 6; indexInLayer = i - 20; } 
        else { y = -2.4; r = 0; sides = 1; indexInLayer = 0; } 
        const angle = (indexInLayer / sides) * Math.PI * 2;
        targetPos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      }

      currentPositions[i].lerp(targetPos, 0.04);
      dummy.position.copy(currentPositions[i]);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[sharedGeometry, sharedMaterial, 27]} />
    </group>
  );
};

// ------------------------------------------------------------------
// REUSABLE POST CARD COMPONENT
// ------------------------------------------------------------------
const PostCard = ({ post, onClick, compact }) => {
  const isLinkOnly = !post.image && !post.description && post.link;

  if (compact) {
    return (
      <div onClick={onClick} style={{ width: '100%', height: '350px', background: 'rgba(15, 15, 15, 0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '1rem', boxSizing: 'border-box' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
           <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#FFF', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{post.title || 'untitled'}</span>
           <span style={{ fontSize: '0.8rem', color: '#888', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{post.date}</span>
         </div>
         {post.image && (
           <div style={{ width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
             <img src={post.image} alt="post" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
           </div>
         )}
         {post.description && (
           <p style={{ fontSize: '0.9rem', color: '#CCC', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{post.description}</p>
         )}
      </div>
    );
  }

  return (
    <div 
      style={{ 
        width: '850px', 
        height: '75vh', 
        maxWidth: '90vw',
        background: 'transparent',
        padding: '2rem 0', 
        display: 'flex', flexDirection: 'column', gap: '2rem',
        boxSizing: 'border-box',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
        <span style={{ fontWeight: 'normal', fontSize: '4rem', color: '#FFF', lineHeight: 1 }}>{post.title || 'untitled'}</span>
        <span style={{ fontSize: '1.2rem', color: '#888', paddingBottom: '0.5rem' }}>{post.date}</span>
      </div>
      
      <div style={{ flex: 1, display: 'flex', gap: '3rem', minHeight: 0, paddingBottom: (!isLinkOnly && post.link) ? '4rem' : '0' }}>
        
        {isLinkOnly ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ padding: '6px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '9999px' }}>
              <div style={{ background: '#FFF', borderRadius: '9999px', padding: '1.2rem 3rem', mixBlendMode: 'screen', cursor: 'pointer' }}>
                <a 
                  href={post.link} target="_blank" rel="noreferrer" 
                  onClick={e => e.stopPropagation()} 
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ display: 'inline-block', color: '#000', textDecoration: 'none', fontSize: '1.4rem', fontWeight: 'bold', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
                >
                  {post.linkText || 'visit link ↗'}
                </a>
              </div>
            </div>
          </div>
        ) : (
          <>
            {post.image && (
              <div style={{ flex: post.description ? '1 1 50%' : '1 1 100%', height: '100%', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <img src={post.image} alt="post" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            )}
            
            {post.description && (
              <div 
                style={{ flex: '1 1 50%', overflowY: 'auto', paddingRight: '1rem' }}
                onWheel={(e) => e.stopPropagation()} 
                onPointerDown={(e) => e.stopPropagation()}
              >
                <p style={{ fontSize: '1.2rem', color: '#DDD', margin: 0, lineHeight: 1.6 }}>{post.description}</p>
              </div>
            )}
          </>
        )}
      </div>

      {(!isLinkOnly && post.link) && (
        <div style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', justifyContent: 'center', width: '100%' }}>
          <div style={{ background: '#FFF', borderRadius: '9999px', padding: '0.8rem 2rem', mixBlendMode: 'screen', cursor: 'pointer' }}>
            <a 
              href={post.link} target="_blank" rel="noreferrer" 
              onClick={e => e.stopPropagation()} 
              onPointerDown={(e) => e.stopPropagation()}
              style={{ display: 'inline-block', color: '#000', textDecoration: 'none', fontSize: '1rem', fontWeight: 'bold', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
            >
              {post.linkText || 'visit link ↗'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
};


// ------------------------------------------------------------------
// MAIN APP COMPONENT
// ------------------------------------------------------------------
export default function App() {
  const [activePage, setActivePage] = useState('home');
  const [overlayMode, setOverlayMode] = useState('none'); 
  const [homeWobble, setHomeWobble] = useState(0); 

  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [devPassword, setDevPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [adminToken, setAdminToken] = useState(null); 

  const [posts, setPosts] = useState([]);
  const [editingPost, setEditingPost] = useState(null);

  const [publicGalleryIndex, setPublicGalleryIndex] = useState(0);
  const [scrollBounce, setScrollBounce] = useState(0); 
  const lastScrollTime = useRef(0); 
  
  const API_BASE = 'https://leamen-backend-production.up.railway.app';

  useEffect(() => {
    fetch(`${API_BASE}/posts`)
      .then(res => res.json())
      .then(data => setPosts(data))
      .catch(err => console.error("Failed to load posts:", err));
  }, []);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setOverlayMode((prev) => {
          if (prev === 'post_edit') return 'dev_dashboard';
          return 'none';
        });
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const inputStyle = {
    width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '12px', padding: '1rem', color: '#FFF', fontFamily: 'inherit',
    fontSize: '1rem', marginBottom: '1rem', outline: 'none', boxSizing: 'border-box'
  };

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const dateA = Date.parse(a.date);
      const dateB = Date.parse(b.date);
      if (!isNaN(dateA) && !isNaN(dateB)) return dateB - dateA;
      return b.id - a.id; 
    });
  }, [posts]);

  const activeGroupPosts = sortedPosts.filter(p => p.group === activePage);

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: contactEmail, subject: contactSubject, message: contactMessage })
      });

      if (response.ok) {
        setSendSuccess(true);
        setContactEmail(''); setContactSubject(''); setContactMessage('');
        setTimeout(() => setSendSuccess(false), 3000);
      }
    } catch (error) {
      console.error("Failed to send email:", error);
    } finally {
      setIsSending(false);
    }
  };

  const handleDevSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: devPassword })
      });

      if (response.ok) {
        const data = await response.json();
        setAdminToken(data.token); 
        setDevPassword('');
        setLoginError(false);
        setOverlayMode('dev_dashboard');
      } else {
        setLoginError(true);
      }
    } catch (error) {
      setLoginError(true);
    }
  };

  const handleCreateNewPost = () => {
    setEditingPost({ title: '', date: '', group: '', image: '', description: '', link: '', linkText: '' });
    setOverlayMode('post_edit');
  };

  const handleSavePost = async () => {
    const isNew = !editingPost.id;
    const method = isNew ? 'POST' : 'PUT';
    const endpoint = isNew ? `${API_BASE}/posts` : `${API_BASE}/posts/${editingPost.id}`;

    try {
      const response = await fetch(endpoint, {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}` 
        },
        body: JSON.stringify(editingPost)
      });

      if (response.ok) {
        const savedPost = await response.json();
        setPosts(prev => isNew ? [savedPost, ...prev] : prev.map(p => p.id === savedPost.id ? savedPost : p));
        setEditingPost(null);
        setOverlayMode('dev_dashboard');
      }
    } catch (error) {
      console.error("Failed to save post");
    }
  };

  const handleDeletePost = async () => {
    if (!editingPost.id) {
      setEditingPost(null);
      setOverlayMode('dev_dashboard');
      return;
    }

    if (window.confirm("Are you sure you want to delete this post?")) {
      try {
        const response = await fetch(`${API_BASE}/posts/${editingPost.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        if (response.ok) {
          setPosts(prev => prev.filter(p => p.id !== editingPost.id));
          setEditingPost(null);
          setOverlayMode('dev_dashboard');
        }
      } catch (error) {
        console.error("Failed to delete post");
      }
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file); 
      setEditingPost({ ...editingPost, image: url });
    }
  };

  const openPublicGallery = (page) => {
    setActivePage(page.toLowerCase());
    setPublicGalleryIndex(0); 
    setOverlayMode('public_gallery');
  };

  return (
    // FIX 1: Swapped 100vh for 100dvh to prevent mobile browsers from hiding the bottom
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', backgroundColor: '#050505', color: '#F5F5F5', fontFamily: 'Palatino Light', margin: 0, overflow: 'hidden', position: 'relative' }}>
      
      {/* LEFT PANEL: Navigation */}
      {/* FIX 2: Used responsive math min/max so the padding scales down gracefully on small screens without breaking the design */}
      <nav style={{ width: 'min(300px, 80vw)', padding: 'min(3rem, 6vh) min(3rem, 6vw)', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '1rem', borderRight: '1px solid #1A1A1A', background: 'rgba(5, 5, 5, 0.2)', backdropFilter: 'blur(10px)' }}>
        <h1 style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: '1.2rem', textTransform: 'lowercase', letterSpacing: '0.02em', marginBottom: '2rem', color: '#666666' }}>
          leamen
        </h1>
        
        {['Home', 'Code', 'Design', 'Music', 'Shop'].map((item) => (
          <button
            key={item}
            onMouseEnter={() => overlayMode === 'none' && setActivePage(item.toLowerCase())}
            onClick={() => {
              if (item === 'Home') {
                setHomeWobble(prev => prev + 1);
                setOverlayMode('none'); 
              } else {
                openPublicGallery(item);
              }
            }}
            style={{
              fontFamily: 'inherit', background: 'transparent', border: 'none',
              color: activePage === item.toLowerCase() ? '#FFFFFF' : '#444444',
              textAlign: 'left', fontSize: '3rem', fontWeight: 'light', cursor: 'pointer',
              padding: 0, textShadow: activePage === item.toLowerCase() ? '0 0 20px rgba(255,255,255,0.5)' : 'none',
              display: 'inline-flex'
            }}
          >
            {item === 'Home' ? (
              <motion.div
                key={homeWobble} 
                initial={{ scale: 1 }}
                animate={homeWobble > 0 ? { scale: [1, 1.05, 0.98, 1.02, 1] } : {}}
                transition={{ duration: 0.6, ease: "easeInOut" }}
                style={{ originX: 0, originY: 0.5 }}
              >
                {item}
              </motion.div>
            ) : ( item )}
          </button>
        ))}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {['Contact', 'Dev View'].map((item) => (
            <button
              key={item}
              onClick={() => {
                if (item === 'Contact') setOverlayMode('contact');
                else if (item === 'Dev View') setOverlayMode(adminToken ? 'dev_dashboard' : 'dev_login');
              }}
              style={{
                fontFamily: 'inherit', background: 'transparent', border: 'none',
                color: '#666666', textAlign: 'left', fontSize: '1rem', letterSpacing: '0.05em',
                cursor: 'pointer', padding: '0.5rem 0', transition: 'color 0.3s ease',
              }}
              onMouseEnter={(e) => e.target.style.color = '#FFFFFF'}
              onMouseLeave={(e) => e.target.style.color = '#666666'}
            >
              {item}
            </button>
          ))}
        </div>
      </nav>

      {/* RIGHT PANEL: 3D Canvas */}
      <div style={{ flex: 1, position: 'absolute', inset: 0, zIndex: 0 }}>
        <Canvas camera={{ position: [0, 0, 9], fov: 50 }}>
          <Environment preset="city" />
          <ambientLight intensity={0.2} />
          <spotLight position={[10, 10, 10]} intensity={2} color="#ff9000" penumbra={1} />
          <spotLight position={[-10, -10, -10]} intensity={2} color="#00d8ff" penumbra={1} />
          <SphereCluster activePage={activePage} overlayMode={overlayMode} />
          <EffectComposer disableNormalPass>
            <Bloom luminanceThreshold={0.1} mipmapBlur intensity={4.0} />
            <Noise opacity={0.06} />
          </EffectComposer>
        </Canvas>
      </div>

      {/* THE OVERLAY SYSTEM */}
      <AnimatePresence>
        {overlayMode !== 'none' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              position: 'absolute', inset: 0, zIndex: 20, 
              backdropFilter: 'blur(15px)', willChange: 'opacity',
              backgroundColor: 'rgba(5, 5, 5, 0.4)', 
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}
          >
            
            {/* 1. CONTACT FORM */}
            {overlayMode === 'contact' && (
              <motion.form 
                onSubmit={handleContactSubmit}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                style={{ width: '400px', maxWidth: '90%', display: 'flex', flexDirection: 'column' }}
              >
                <input type="email" placeholder="email" required style={inputStyle} value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                <input type="text" placeholder="subject" required style={inputStyle} value={contactSubject} onChange={e => setContactSubject(e.target.value)} />
                <textarea placeholder="message" required rows={5} style={{...inputStyle, resize: 'none'}} value={contactMessage} onChange={e => setContactMessage(e.target.value)} />
                <div style={{ background: '#FFF', borderRadius: '12px', padding: '1rem', cursor: isSending ? 'default' : 'pointer', textAlign: 'center', mixBlendMode: 'screen' }}>
                  <button 
                    type="submit" 
                    disabled={isSending}
                    style={{ background: 'transparent', border: 'none', color: '#000', fontSize: '1.2rem', fontFamily: 'inherit', cursor: isSending ? 'default' : 'pointer', width: '100%', fontWeight: 'bold' }}
                  >
                    {isSending ? 'sending...' : sendSuccess ? 'sent!' : 'send'}
                  </button>
                </div>
              </motion.form>
            )}

            {/* 2. DEV VIEW LOGIN */}
            {overlayMode === 'dev_login' && (
              <motion.form 
                onSubmit={handleDevSubmit}
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                style={{ width: '400px', maxWidth: '90%', position: 'relative' }}
              >
                <input 
                  type={showPassword ? "text" : "password"} placeholder="password" required 
                  style={{ ...inputStyle, paddingRight: '100px', borderColor: loginError ? '#ff4444' : 'rgba(255,255,255,0.3)' }} 
                  value={devPassword} onChange={e => setDevPassword(e.target.value)} 
                />
                <div style={{ position: 'absolute', right: '10px', top: '15px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                  <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#FFF', padding: 0, display: 'flex' }}>
                    {showPassword ? (
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    ) : (
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    )}
                  </button>
                  <button type="submit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#FFF', padding: 0, display: 'flex' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </button>
                </div>
              </motion.form>
            )}

            {/* 3. DEV DASHBOARD */}
            {overlayMode === 'dev_dashboard' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ width: '80%', height: '70%', overflowY: 'auto', padding: '2rem', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                  <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 'normal', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>Posts</h2>
                  <button 
                    onClick={() => setOverlayMode('none')}
                    style={{ background: 'transparent', border: 'none', color: '#FFF', fontSize: '1.2rem', cursor: 'pointer', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', letterSpacing: '0.05em' }}
                  >
                    ← back
                  </button>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2rem' }}>
                  <div 
                    onClick={handleCreateNewPost}
                    style={{ width: '100%', minHeight: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,15,15,0.4)', border: '2px dashed rgba(255,255,255,0.2)', borderRadius: '16px', cursor: 'pointer', transition: 'background 0.3s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(15,15,15,0.4)'}
                  >
                    <span style={{ fontSize: '4rem', color: 'rgba(255,255,255,0.3)', fontWeight: 'light' }}>+</span>
                  </div>

                  {sortedPosts.map(post => (
                    <PostCard key={post.id} post={post} onClick={() => { setEditingPost(post); setOverlayMode('post_edit'); }} compact />
                  ))}
                </div>
              </motion.div>
            )}

            {/* 4. POST CREATION / EDIT SCREEN */}
            {overlayMode === 'post_edit' && editingPost && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} 
                style={{ 
                  width: '500px', maxWidth: '90%', background: 'rgba(20,20,20,0.9)', padding: '2rem', borderRadius: '16px', 
                  border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '1rem', 
                  maxHeight: '80vh', overflowY: 'auto', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'normal' }}>Edit Post</h3>
                  <button onClick={() => setOverlayMode('dev_dashboard')} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontFamily: 'inherit', fontSize: '1rem' }}>Cancel</button>
                </div>
                
                <input type="text" placeholder="Title (e.g. New Project)" style={inputStyle} value={editingPost.title} onChange={e => setEditingPost({...editingPost, title: e.target.value})} />
                <input type="text" placeholder="Date (e.g. Oct 2026)" style={inputStyle} value={editingPost.date} onChange={e => setEditingPost({...editingPost, date: e.target.value})} />
                
                <select style={inputStyle} value={editingPost.group} onChange={e => setEditingPost({...editingPost, group: e.target.value})}>
                  <option value="">Draft (No Group)</option>
                  <option value="code">Code</option>
                  <option value="design">Design</option>
                  <option value="music">Music</option>
                  <option value="shop">Shop</option>
                </select>

                <div style={{ ...inputStyle, padding: '0.5rem 1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#888' }}>Upload Image</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} style={{ color: '#FFF' }} />
                </div>

                <textarea placeholder="Description..." rows={4} style={{...inputStyle, resize: 'none'}} value={editingPost.description} onChange={e => setEditingPost({...editingPost, description: e.target.value})} />
                <input type="text" placeholder="Link URL (e.g. https://github.com)" style={inputStyle} value={editingPost.link} onChange={e => setEditingPost({...editingPost, link: e.target.value})} />
                <input type="text" placeholder="Link Text (e.g. View Source)" style={inputStyle} value={editingPost.linkText} onChange={e => setEditingPost({...editingPost, linkText: e.target.value})} />

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <button onClick={handleDeletePost} style={{ flex: 1, padding: '1rem', background: 'transparent', border: '1px solid #ff4444', color: '#ff4444', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '1.1rem' }}>Delete</button>
                  <button onClick={handleSavePost} style={{ flex: 2, padding: '1rem', background: '#FFF', border: 'none', color: '#000', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '1.1rem', fontWeight: 'bold' }}>Save Post</button>
                </div>
              </motion.div>
            )}

            {/* 5. PUBLIC GALLERY */}
            {overlayMode === 'public_gallery' && (
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1, x: scrollBounce }} 
                transition={{ type: 'spring', stiffness: 400, damping: 20 }} 
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.15}
                onDragEnd={(e, { offset }) => {
                  if (offset.x < -50 && publicGalleryIndex < activeGroupPosts.length - 1) {
                    setPublicGalleryIndex(publicGalleryIndex + 1);
                  } else if (offset.x > 50 && publicGalleryIndex > 0) {
                    setPublicGalleryIndex(publicGalleryIndex - 1);
                  }
                }}
                onWheel={(e) => {
                  if (activeGroupPosts.length <= 1) return;
                  const now = Date.now();
                  if (now - lastScrollTime.current < 400) return; 
                  
                  if (e.deltaY > 20) {
                    lastScrollTime.current = now;
                    if (publicGalleryIndex < activeGroupPosts.length - 1) {
                      setPublicGalleryIndex(p => p + 1);
                    } else {
                      setScrollBounce(-40); setTimeout(() => setScrollBounce(0), 100); 
                    }
                  } else if (e.deltaY < -20) {
                    lastScrollTime.current = now;
                    if (publicGalleryIndex > 0) {
                      setPublicGalleryIndex(p => p - 1);
                    } else {
                      setScrollBounce(40); setTimeout(() => setScrollBounce(0), 100); 
                    }
                  }
                }}
                style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: '10vh' }}
              >
                {activeGroupPosts.length === 0 ? (
                  <p style={{ color: '#BBB', fontSize: '1.2rem', fontFamily: 'inherit' }}>under renovation.</p>
                ) : (
                  activeGroupPosts.map((post, i) => {
                    const offset = i - publicGalleryIndex; 
                    return (
                      <motion.div
                        key={post.id}
                        onClick={() => setPublicGalleryIndex(i)} 
                        animate={{ 
                          x: offset * 950, 
                          scale: offset === 0 ? 1 : 0.85,
                          filter: offset === 0 ? 'blur(0px)' : 'blur(8px)',
                          opacity: offset === 0 ? 1 : 0.4
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        style={{ position: 'absolute', display: 'flex', alignItems: 'center' }}
                      >
                        <PostCard post={post} />
                        
                        {i < activeGroupPosts.length - 1 && (
                          <div style={{ position: 'absolute', right: '-50px', top: '10%', height: '80%', width: '1px', background: 'rgba(255,255,255,0.1)' }} />
                        )}
                      </motion.div>
                    );
                  })
                )}
              </motion.div>
            )}

            {/* SHARED RETURN BUTTON */}
            {(overlayMode !== 'dev_dashboard' && overlayMode !== 'post_edit') && (
              <motion.button
                onClick={() => setOverlayMode('none')} 
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }} 
                whileHover={{ opacity: 0.6 }} 
                // FIX 3: Changed bottom positioning to guarantee it never sinks below 30px from the visible bottom edge
                style={{
                  position: 'absolute', bottom: 'max(4vh, 30px)', fontFamily: 'inherit', fontSize: '1.4rem',
                  color: '#FFFFFF', background: 'transparent', border: 'none', cursor: 'pointer',
                  letterSpacing: '0.15em', textTransform: 'lowercase', padding: '1rem',
                  zIndex: 100 
                }}
              >
                return
              </motion.button>
            )}

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}