import { useState, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { EffectComposer, Bloom, Noise } from '@react-three/postprocessing';
import * as THREE from 'three';

// --- HELPER: Parse links from the DB or fallback to old single-link format ---
const parseLinks = (post) => {
  if (!post.link) return [];
  try {
    const parsed = JSON.parse(post.link);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    return [{ url: post.link, text: post.linkText || 'visit link ↗' }];
  }
  return [];
};

// --- HELPER: Auto-format standard YouTube/Vimeo URLs into Embed URLs ---
const parseVideoUrl = (rawUrl) => {
  let embedUrl = rawUrl;
  try {
    if (rawUrl.includes('youtube.com/watch')) {
      const urlObj = new URL(rawUrl);
      const videoId = urlObj.searchParams.get('v');
      if (videoId) embedUrl = `https://www.youtube.com/embed/${videoId}`;
    } else if (rawUrl.includes('youtu.be/')) {
      const videoId = rawUrl.split('youtu.be/')[1].split('?')[0];
      if (videoId) embedUrl = `https://www.youtube.com/embed/${videoId}`;
    } else if (rawUrl.includes('vimeo.com/')) {
      const videoId = rawUrl.split('vimeo.com/')[1].split('?')[0].split('/').pop();
      if (videoId) embedUrl = `https://player.vimeo.com/video/${videoId}`;
    }
  } catch (e) {
    console.error("Failed to parse video url", e);
  }
  return embedUrl;
};

// --- HELPER: Safely parse dates for Safari (handles mm.dd.yy) ---
// --- HELPER: Bulletproof date parser for Safari (handles mm.dd.yy) ---
const getSafeTimestamp = (dateStr) => {
  if (!dateStr) return 0;
  
  // Split the string by dots (or dashes/slashes just in case) and remove spaces
  const parts = dateStr.trim().split(/[\.\-\/]/);
  
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    
    // Ensure all parts successfully converted to numbers
    if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
      // Expand 2-digit year (26) to 4-digit year (2026)
      if (year < 100) year += 2000;
      
      // Build the date mathematically to bypass Safari's string parser
      // Note: JavaScript months are 0-indexed (0 = Jan), so we subtract 1
      return new Date(year, month - 1, day).getTime();
    }
  }
  
  // Fallback for standard formats
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? 0 : parsed;
};

// ------------------------------------------------------------------
// 3D SCENE COMPONENT (Optimized & Frame-Rate Independent)
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
    const clampedDelta = Math.min(delta, 0.1);

    const targetSpeed = overlayMode !== 'none' ? 4.0 : 1.0;
    speedRef.current = THREE.MathUtils.damp(speedRef.current, targetSpeed, 5, clampedDelta);
    timeRef.current += clampedDelta * speedRef.current * 0.4;
    const t = timeRef.current;

    const targetEmissive = activePage === 'home' ? 0.05 : 0.2;
    sharedMaterial.emissiveIntensity = THREE.MathUtils.damp(sharedMaterial.emissiveIntensity, targetEmissive, 6, clampedDelta);

    if (activePage === 'home') {
      sharedMaterial.emissive.lerp(new THREE.Color("#4a154b"), clampedDelta * 3); 
    } else {
      const hue = 0.85 + Math.sin(t * 0.5) * 0.25; 
      const prismatic = new THREE.Color().setHSL(hue % 1, 0.5, 0.6); 
      sharedMaterial.emissive.lerp(prismatic, clampedDelta * 3);
    }

    let targetX = 0, targetY = 0, targetZ = 0;
    if (activePage === 'code') { targetX = 0.2; targetY = 0.4; }
    else if (activePage === 'design') { targetY = 0.15; targetZ = 0.1; }
    else if (activePage === 'music') { targetX = 0.2; targetY = 0.4; } 
    else if (activePage === 'shop') { targetY = 0.8; } 

    rotSpeed.current.x = THREE.MathUtils.damp(rotSpeed.current.x, targetX, 4, clampedDelta);
    rotSpeed.current.y = THREE.MathUtils.damp(rotSpeed.current.y, targetY, 4, clampedDelta);
    rotSpeed.current.z = THREE.MathUtils.damp(rotSpeed.current.z, targetZ, 4, clampedDelta);

    if (groupRef.current) {
      if (activePage === 'home' || activePage === 'shop') {
        let rx = groupRef.current.rotation.x % (Math.PI * 2);
        let rz = groupRef.current.rotation.z % (Math.PI * 2);
        if (rx > Math.PI) rx -= Math.PI * 2; else if (rx < -Math.PI) rx += Math.PI * 2;
        if (rz > Math.PI) rz -= Math.PI * 2; else if (rz < -Math.PI) rz += Math.PI * 2;

        groupRef.current.rotation.x = rx;
        groupRef.current.rotation.z = rz;

        groupRef.current.rotation.x = THREE.MathUtils.damp(groupRef.current.rotation.x, 0, 4, clampedDelta);
        groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, 0, 4, clampedDelta);
      } else {
        groupRef.current.rotation.x += rotSpeed.current.x * clampedDelta * speedRef.current;
        groupRef.current.rotation.z += rotSpeed.current.z * clampedDelta * speedRef.current;
      }
      groupRef.current.rotation.y += rotSpeed.current.y * clampedDelta * speedRef.current;
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
        // 1. The Nucleus: 3 spheres tightly grouped and spinning in the center
        if (i < 3) {
          const angle = (i / 3) * Math.PI * 2 + (t * 2);
          const radius = 0.25;
          targetPos.set(
            Math.cos(angle) * radius, 
            Math.sin(angle) * radius, 
            Math.cos(angle * 1.5) * radius
          );
        } 
        // 2. The Electron Orbitals: 3 perfectly symmetrical, intersecting rings
        else {
          const electronIdx = i - 3; 
          const ring = Math.floor(electronIdx / 8); // Groups into Ring 0, 1, or 2
          const offset = (electronIdx % 8) * (Math.PI / 4); // Spaces 8 spheres evenly
          
          const radius = 2.0;
          const angle = (t * 1.5) + offset; 
          
          // Create a perfect 2D circle first
          const baseX = Math.cos(angle) * radius;
          const baseY = Math.sin(angle) * radius;
          
          // Tilt each ring by 60 degrees (PI / 3) to create the classic atom cross-section
          const tilt = ring * (Math.PI / 3); 
          
          targetPos.set(
            baseX * Math.cos(tilt),
            baseY,
            baseX * Math.sin(tilt)
          );
        }
      }
      else if (activePage === 'music') {
        const row = Math.floor(i / 9); const col = i % 9; 
        
        const xStagger = (row - 1) * 0.15; 
        
        // 2. Add the stagger to the X calculation
        const x = (col - 4) * 0.72 + xStagger; 
        const z = (row - 1) * 0.72;
        
        // 2. Wave Shape: Lowered x * 1.5 to x * 0.8 to stretch the wave horizontally
        const y = Math.sin(x * 0.8 + row * 0.5 - t * 3.5) * 1.2;
        
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

      currentPositions[i].lerp(targetPos, 1 - Math.exp(-6 * clampedDelta));
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
  const links = parseLinks(post);
  const isEmbed = post.image && post.image.startsWith('embed::');
  const mediaUrl = isEmbed ? post.image.replace('embed::', '') : post.image;
  const isLinkOnly = !mediaUrl && !post.description && links.length > 0;

  if (compact) {
    return (
      <div onClick={onClick} style={{ width: '100%', height: '350px', background: 'rgba(15, 15, 15, 0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '1.5rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '1rem', boxSizing: 'border-box' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
           <span style={{ fontWeight: 'bold', fontSize: '1.2rem', color: '#FFF', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{post.title || 'untitled'}</span>
           <span style={{ fontSize: '0.8rem', color: '#888', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>{post.date}</span>
         </div>
         {mediaUrl && (
           <div style={{ width: '100%', height: '140px', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: isEmbed ? 'rgba(0,0,0,0.4)' : 'transparent' }}>
             {isEmbed ? (
               <div style={{ color: '#888', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>
                 <span style={{ fontSize: '1.5rem' }}>▶</span> <span>Video Embed</span>
               </div>
             ) : (
               <img src={mediaUrl} alt="post" style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
             )}
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
        <span style={{ fontWeight: 'normal', fontSize: 'clamp(2rem, 5vw, 4rem)', color: '#FFF', lineHeight: 1 }}>{post.title || 'untitled'}</span>
        <span style={{ fontSize: '1.2rem', color: '#888', paddingBottom: '0.5rem' }}>{post.date}</span>
      </div>
      
      <div style={{ flex: 1, display: 'flex', gap: '3rem', minHeight: 0, paddingBottom: (!isLinkOnly && links.length > 0) ? '4rem' : '0' }}>
        
        {isLinkOnly ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            {/* NEW INNER WRAPPER forces all children to match the widest child's width */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: 'max-content' }}>
              {links.map((l, i) => (
                <div key={i} style={{ padding: '6px', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '9999px', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{ background: '#FFF', borderRadius: '9999px', cursor: 'pointer', isolation: 'isolate' }}>
                    <a 
                      href={l.url} target="_blank" rel="noreferrer" 
                      onClick={e => e.stopPropagation()} 
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ 
                        display: 'block', padding: '1.2rem 3rem', color: '#000', 
                        mixBlendMode: 'destination-out', textDecoration: 'none', 
                        fontSize: '1.4rem', fontWeight: 'bold', 
                        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', 
                        textAlign: 'center' // Added to keep the text perfectly centered in the stretched buttons
                      }}
                    >
                      {l.text || 'visit link ↗'}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {mediaUrl && (
              <div style={{ flex: post.description ? '1 1 50%' : '1 1 100%', height: '100%', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isEmbed ? (
                  <iframe 
                    src={mediaUrl} 
                    style={{ width: '100%', height: '100%', border: 'none', borderRadius: '4px' }}
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                ) : (
                  <img src={mediaUrl} alt="post" style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
                )}
              </div>
            )}
            
            {post.description && (
              <div 
                onWheel={(e) => e.stopPropagation()} 
                onPointerDown={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                style={{ 
                  flex: '1 1 50%', 
                  paddingRight: '1rem',
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                  touchAction: 'pan-y'
                }}
              >
                <p style={{ fontSize: '1.2rem', color: '#DDD', margin: 0, lineHeight: 1.6 }}>{post.description}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* HORIZONTAL LINKS (For Standard Cards) */}
      {(!isLinkOnly && links.length > 0) && (
        <div style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'row', justifyContent: 'center', gap: '1rem', width: '100%', flexWrap: 'wrap' }}>
          {links.map((l, i) => (
            <div key={i} style={{ background: '#FFF', borderRadius: '9999px', cursor: 'pointer', isolation: 'isolate' }}>
              <a
                href={l.url} target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                style={{ display: 'block', padding: '0.8rem 2rem', color: '#000', mixBlendMode: 'destination-out', textDecoration: 'none', fontSize: '1rem', fontWeight: 'bold', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
              >
                {l.text || 'visit link ↗'}
              </a>
            </div>
          ))}
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
  const [isLoadingPosts, setIsLoadingPosts] = useState(true);
  const [editingPost, setEditingPost] = useState(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [embedInputText, setEmbedInputText] = useState(''); // Text input for video URL

  const [publicGalleryIndex, setPublicGalleryIndex] = useState(0);
  const [scrollBounce, setScrollBounce] = useState(0); 
  const lastScrollTime = useRef(0); 
  
  const API_BASE = '/api';

  // --- URL ROUTING LOGIC ---
  const updateURL = (path) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
  };

  useEffect(() => {
    const handleUrlChange = () => {
      const path = window.location.pathname.replace('/', '').toLowerCase();
      if (path === 'contact') {
        setOverlayMode('contact');
      } else if (['code', 'design', 'music', 'shop'].includes(path)) {
        setActivePage(path);
        setOverlayMode('public_gallery');
      } else {
        setOverlayMode('none');
        setActivePage('home');
      }
    };

    handleUrlChange();

    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // --- DYNAMIC TAB TITLE LOGIC ---
  useEffect(() => {
    if (overlayMode === 'contact') {
      document.title = 'Contact';
    } else if (overlayMode === 'public_gallery' && ['code', 'design', 'music', 'shop'].includes(activePage)) {
      document.title = activePage.charAt(0).toUpperCase() + activePage.slice(1);
    } else {
      document.title = 'leamen';
    }
  }, [activePage, overlayMode]);
  
  useEffect(() => {
    setIsLoadingPosts(true);
    fetch(`${API_BASE}/posts`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setPosts(data);
        } else {
          setPosts([]); 
        }
      })
      .catch(err => {
        console.error("Failed to load posts:", err);
        setPosts([]); 
      })
      .finally(() => {
        setIsLoadingPosts(false);
      });
  }, []);

  // ESCAPE KEY LOGIC 
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        setOverlayMode((prev) => {
          if (prev === 'post_edit') return 'dev_dashboard';
          if (prev !== 'none') {
            updateURL('/');
            return 'none';
          }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  // HIDDEN ADMIN SHORTCUT (Cmd/Ctrl + Shift + L)
  useEffect(() => {
    const handleAdminShortcut = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault(); // Prevents the browser from triggering default shortcuts
        setOverlayMode(adminToken ? 'dev_dashboard' : 'dev_login');
      }
    };
    window.addEventListener('keydown', handleAdminShortcut);
    return () => window.removeEventListener('keydown', handleAdminShortcut);
  }, [adminToken]);

  const inputStyle = {
    width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '12px', padding: '1rem', color: '#FFF', fontFamily: 'inherit',
    fontSize: '1rem', marginBottom: '1rem', outline: 'none', boxSizing: 'border-box'
  };

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      const dateA = getSafeTimestamp(a.date);
      const dateB = getSafeTimestamp(b.date);
      
      // If the dates are different, sort chronologically
      if (dateA !== dateB) {
        return dateB - dateA;
      }
      
      // If the dates are identical (or both blank), sort by newest added
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
    setEditingPost({ title: '', date: '', group: '', image: '', description: '', links: [] });
    setEmbedInputText('');
    setOverlayMode('post_edit');
  };

  const handleAddEmbed = () => {
    if (!embedInputText) return;
    const formattedUrl = parseVideoUrl(embedInputText);
    setEditingPost({ ...editingPost, image: `embed::${formattedUrl}` });
    setEmbedInputText('');
  };

  const handleSavePost = async () => {
    const isNew = !editingPost.id;
    const method = isNew ? 'POST' : 'PUT';
    const endpoint = isNew ? `${API_BASE}/posts` : `${API_BASE}/posts/${editingPost.id}`;

    const cleanedLinks = (editingPost.links || []).filter(l => l.url && l.url.trim() !== '');
    
    const payload = {
      title: editingPost.title,
      date: editingPost.date,
      group: editingPost.group,
      image: editingPost.image,
      description: editingPost.description,
      link: JSON.stringify(cleanedLinks), 
      linkText: '' 
    };

    try {
      const response = await fetch(endpoint, {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}` 
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const savedPost = await response.json();
        setPosts(prev => isNew ? [savedPost, ...prev] : prev.map(p => p.id === savedPost.id ? savedPost : p));
        setEditingPost(null);
        setOverlayMode('dev_dashboard');
      } else {
        const errorData = await response.json();
        alert(`Backend Error: ${errorData.detail || JSON.stringify(errorData)}`);
      }
    } catch (error) {
      alert("Network Error: Could not reach the server.");
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
        } else {
          const errorData = await response.json();
          alert(`Delete Error: ${errorData.detail || JSON.stringify(errorData)}`);
        }
      } catch (error) {
        alert("Network Error: Could not reach the server.");
      }
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploadingImage(true); 

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'leamen_portfolio'); // Must match your Cloudinary preset exactly

    try {
      // Remember to put your actual cloud name back in here!
      const response = await fetch('https://api.cloudinary.com/v1_1/cwl2kjkf/image/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      
      if (data.secure_url) {
        setEditingPost({ ...editingPost, image: data.secure_url });
      } else {
        // THIS WILL REVEAL THE INVISIBLE CLOUDINARY ERROR
        alert(`Cloudinary Error: ${data.error.message}`);
      }
    } catch (error) {
      alert(`Network Error: ${error.message}`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const openPublicGallery = (page) => {
    const lower = page.toLowerCase();
    setActivePage(lower);
    setPublicGalleryIndex(0); 
    setOverlayMode('public_gallery');
    updateURL(`/${lower}`);
  };

  return (
    <div style={{ width: '100vw', height: '100dvh', display: 'flex', backgroundColor: '#050505', color: '#F5F5F5', fontFamily: 'Palatino Light', margin: 0, overflow: 'hidden', position: 'relative' }}>
      
      {/* LEFT PANEL: Navigation */}
      <nav style={{ width: 'min(250px, 80vw)', padding: 'min(3rem, 6vh) min(3rem, 6vw)', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '1rem', borderRight: '1px solid #1A1A1A', background: 'rgba(5, 5, 5, 0.2)', backdropFilter: 'blur(10px)' }}>
        
        <motion.h1 
          key={homeWobble} 
          onMouseEnter={() => overlayMode === 'none' && setActivePage('home')}
          onClick={() => {
            setHomeWobble(prev => prev + 1);
            setOverlayMode('none'); 
            updateURL('/');
          }}
          initial={{ scale: 1 }}
          animate={homeWobble > 0 ? { scale: [1, 1.05, 0.98, 1.02, 1] } : {}}
          transition={{ duration: 0.6, ease: "easeInOut" }}
          style={{ 
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', 
            fontSize: '1.4rem', 
            textTransform: 'lowercase', 
            letterSpacing: '0.02em', 
            margin: '0 0 2rem 0', 
            color: activePage === 'home' ? '#FFFFFF' : '#888888',
            textShadow: activePage === 'home' ? '0 0 20px rgba(255,255,255,0.5)' : 'none',
            cursor: 'pointer',
            originX: 0, originY: 0.5
          }}
        >
          leamen
        </motion.h1>
        
        {['Code', 'Design', 'Music', 'Shop'].map((item) => (
          <button
            key={item}
            onMouseEnter={() => overlayMode === 'none' && setActivePage(item.toLowerCase())}
            onClick={() => openPublicGallery(item)}
            style={{
              fontFamily: 'inherit', background: 'transparent', border: 'none',
              color: activePage === item.toLowerCase() ? '#FFFFFF' : '#888888',
              textAlign: 'left', fontSize: '3rem', fontWeight: 'light', cursor: 'pointer',
              padding: 0, textShadow: activePage === item.toLowerCase() ? '0 0 20px rgba(255,255,255,0.5)' : 'none',
              display: 'inline-flex'
            }}
          >
            {item}
          </button>
        ))}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {['Contact'].map((item) => (
            <button
              key={item}
              onClick={() => {
                if (item === 'Contact') {
                  setOverlayMode('contact');
                  updateURL('/contact');
                }
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
        <Canvas 
          camera={{ position: [0, 0, 9], fov: 50 }} 
          dpr={[1, 2]}
          gl={{ powerPreference: "high-performance", antialias: true }}
        >
          <Environment preset="city" />
          <ambientLight intensity={0.2} />
          <spotLight position={[10, 10, 10]} intensity={2} color="#ff9000" penumbra={1} />
          <spotLight position={[-10, -10, -10]} intensity={2} color="#00d8ff" penumbra={1} />
          <SphereCluster activePage={activePage} overlayMode={overlayMode} />
          <EffectComposer multisampling={4}>
            <Bloom luminanceThreshold={0.1} mipmapBlur intensity={3.5} />
            <Noise opacity={0.06} />
          </EffectComposer>
        </Canvas>
      </div>

      {/* THE OVERLAY SYSTEM */}
      <AnimatePresence>
        {overlayMode !== 'none' && (
          <motion.div
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0, pointerEvents: 'none' }} 
            transition={{ duration: 0.3, ease: 'easeOut' }}
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
                <div style={{ background: '#FFF', borderRadius: '12px', cursor: isSending ? 'default' : 'pointer', textAlign: 'center', mixBlendMode: 'screen' }}>
                  <button
                    type="submit"
                    disabled={isSending}
                    style={{ background: 'transparent', border: 'none', padding: '1rem', color: '#000', fontSize: '1.2rem', fontFamily: 'inherit', cursor: isSending ? 'default' : 'pointer', width: '100%', fontWeight: 'bold' }}
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
                  <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 'normal', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}>Studio</h2>
                  <button 
                    onClick={() => {
                      setOverlayMode('none');
                    }}
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
                    <PostCard key={post.id} post={post} onClick={() => { 
                      setEditingPost({ ...post, links: parseLinks(post) }); 
                      setEmbedInputText('');
                      setOverlayMode('post_edit'); 
                    }} compact />
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

                {/* DUAL UPLOAD / EMBED INTERFACE */}
                <div style={{ ...inputStyle, padding: '0.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.9rem', color: isUploadingImage ? '#FFF' : '#888' }}>
                      {editingPost.image ? 'Media Attached' : 'Attach Media (Image or Video)'}
                    </label>
                    {editingPost.image && (
                      <button 
                        type="button" 
                        onClick={() => setEditingPost({ ...editingPost, image: '' })}
                        style={{ background: 'transparent', border: 'none', color: '#ff4444', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
                      >
                        Remove Media
                      </button>
                    )}
                  </div>
                  
                  {!editingPost.image && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Upload Image</label>
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={handleImageUpload} 
                          disabled={isUploadingImage}
                          style={{ 
                            color: '#FFF', 
                            opacity: isUploadingImage ? 0.3 : 1, 
                            cursor: isUploadingImage ? 'wait' : 'pointer',
                            width: '100%'
                          }} 
                        />
                      </div>

                      <div style={{ textAlign: 'center', color: '#444', fontSize: '0.8rem' }}>OR</div>

                      <div>
                         <label style={{ fontSize: '0.8rem', color: '#666', display: 'block', marginBottom: '0.2rem' }}>Embed Video (YouTube / Vimeo URL)</label>
                         <div style={{ display: 'flex', gap: '0.5rem' }}>
                           <input 
                             type="text" 
                             placeholder="https://youtube.com/watch?v=..." 
                             value={embedInputText} 
                             onChange={e => setEmbedInputText(e.target.value)} 
                             style={{ ...inputStyle, marginBottom: 0, flex: 1, padding: '0.5rem' }}
                           />
                           <button 
                             type="button" 
                             onClick={handleAddEmbed}
                             style={{ background: '#FFF', color: '#000', border: 'none', borderRadius: '8px', padding: '0 1rem', cursor: 'pointer', fontWeight: 'bold' }}
                           >
                             Add
                           </button>
                         </div>
                      </div>
                    </div>
                  )}

                  {/* MEDIA PREVIEW */}
                  {editingPost.image && (
                    <div style={{ marginTop: '1rem', width: '100%', height: '160px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {editingPost.image.startsWith('embed::') ? (
                        <iframe 
                          src={editingPost.image.replace('embed::', '')} 
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          title="video preview"
                        ></iframe>
                      ) : (
                        <img src={editingPost.image} alt="post preview" style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain' }} />
                      )}
                    </div>
                  )}
                </div>

                <textarea placeholder="Description..." rows={4} style={{...inputStyle, resize: 'none'}} value={editingPost.description} onChange={e => setEditingPost({...editingPost, description: e.target.value})} />
                
                {/* DYNAMIC LINKS EDITOR */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.9rem', color: '#888' }}>Links (Max 5)</label>
                  {(editingPost.links || []).map((lnk, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input 
                        type="text" placeholder="URL (https://...)" 
                        style={{...inputStyle, marginBottom: 0, flex: 2}} 
                        value={lnk.url} 
                        onChange={e => {
                          const newLinks = [...editingPost.links];
                          newLinks[idx].url = e.target.value;
                          setEditingPost({...editingPost, links: newLinks});
                        }} 
                      />
                      <input 
                        type="text" placeholder="Text (e.g. GitHub)" 
                        style={{...inputStyle, marginBottom: 0, flex: 1}} 
                        value={lnk.text} 
                        onChange={e => {
                          const newLinks = [...editingPost.links];
                          newLinks[idx].text = e.target.value;
                          setEditingPost({...editingPost, links: newLinks});
                        }} 
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          const newLinks = editingPost.links.filter((_, i) => i !== idx);
                          setEditingPost({...editingPost, links: newLinks});
                        }} 
                        style={{ background: 'transparent', border: 'none', color: '#ff4444', cursor: 'pointer', padding: '0 0.5rem', fontSize: '1.2rem' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  
                  {(editingPost.links || []).length < 5 && (
                    <button 
                      type="button" 
                      onClick={() => setEditingPost({...editingPost, links: [...(editingPost.links || []), {url: '', text: ''}]})} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', color: '#FFF', padding: '0.8rem', borderRadius: '12px', cursor: 'pointer', fontSize: '0.9rem', marginTop: '0.5rem' }}
                    >
                      + Add Link
                    </button>
                  )}
                </div>

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
                {isLoadingPosts ? (
                  <p style={{ color: '#BBB', fontSize: '1.2rem', fontFamily: 'inherit' }}>loading...</p>
                ) : activeGroupPosts.length === 0 ? (
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

            {/* SHARED RETURN BUTTON & GALLERY NAVIGATION */}
            {(overlayMode !== 'dev_dashboard' && overlayMode !== 'post_edit') && (
              <motion.div
                initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                transition={{ delay: 0.15, duration: 0.5, ease: 'easeOut' }} 
                style={{
                  position: 'absolute', bottom: 'max(4vh, 30px)', display: 'flex', alignItems: 'center', 
                  gap: 'min(3rem, 8vw)', zIndex: 100 
                }}
              >
                
                {/* PREVIOUS POST ARROW */}
                {(overlayMode === 'public_gallery' && activeGroupPosts.length > 0) && (
                  <motion.button
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: publicGalleryIndex > 0 ? 0.5 : 0 }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                    whileHover={publicGalleryIndex > 0 ? { opacity: 1, scale: 1.1 } : {}}
                    onClick={() => publicGalleryIndex > 0 && setPublicGalleryIndex(p => p - 1)}
                    style={{
                      color: '#FFF', background: 'transparent', border: 'none', fontSize: '1.8rem', padding: '0.5rem',
                      cursor: publicGalleryIndex > 0 ? 'pointer' : 'default', 
                      pointerEvents: publicGalleryIndex > 0 ? 'auto' : 'none',
                      fontFamily: 'inherit'
                    }}
                  >
                    ←
                  </motion.button>
                )}

                {/* THE RETURN BUTTON */}
                <motion.button
                  onClick={() => {
                    setOverlayMode('none');
                    updateURL('/');
                  }} 
                  whileHover={{ opacity: 0.6 }} 
                  style={{
                    fontFamily: 'inherit', fontSize: '1.4rem', color: '#FFFFFF', background: 'transparent', 
                    border: 'none', cursor: 'pointer', letterSpacing: '0.15em', textTransform: 'lowercase', 
                    padding: '0.5rem 1rem'
                  }}
                >
                  return
                </motion.button>

                {/* NEXT POST ARROW */}
                {(overlayMode === 'public_gallery' && activeGroupPosts.length > 0) && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: publicGalleryIndex < activeGroupPosts.length - 1 ? 0.5 : 0 }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                    whileHover={publicGalleryIndex < activeGroupPosts.length - 1 ? { opacity: 1, scale: 1.1 } : {}}
                    onClick={() => publicGalleryIndex < activeGroupPosts.length - 1 && setPublicGalleryIndex(p => p + 1)}
                    style={{
                      color: '#FFF', background: 'transparent', border: 'none', fontSize: '1.8rem', padding: '0.5rem',
                      cursor: publicGalleryIndex < activeGroupPosts.length - 1 ? 'pointer' : 'default', 
                      pointerEvents: publicGalleryIndex < activeGroupPosts.length - 1 ? 'auto' : 'none',
                      fontFamily: 'inherit'
                    }}
                  >
                    →
                  </motion.button>
                )}

              </motion.div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}