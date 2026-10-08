(function () {
  const Scanner = {
    stream: null,
    facingMode: 'environment',
    orientation: 'landscape',

    async startCamera(video) {
      this.stopCamera(video);
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('Live camera requires HTTPS or localhost. If you opened index.html directly, use a local server/GitHub Pages or choose Take photo instead.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera is not available in this browser. Use Take photo instead or Upload image.');
      }

      const portrait = this.orientation === 'portrait';
      const preferred = {
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: portrait ? 1080 : 1920 },
          height: { ideal: portrait ? 1920 : 1080 },
          aspectRatio: { ideal: portrait ? 0.75 : (4 / 3) }
        },
        audio: false
      };

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(preferred);
      } catch (err) {
        // Some desktop cameras reject facingMode/size constraints. Retry with a plain video request.
        if (['OverconstrainedError', 'NotFoundError'].includes(err?.name)) {
          this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          throw new Error('Camera permission was blocked. Allow camera access in your browser, then press Start camera again.');
        } else if (err?.name === 'NotReadableError') {
          throw new Error('The camera is already being used by another app or browser tab. Close it there and try again.');
        } else {
          throw err;
        }
      }

      video.srcObject = this.stream;
      // Ask supported mobile cameras to keep focus/exposure/white balance moving
      // continuously while the teacher positions the paper. Unsupported browsers
      // simply ignore these optional constraints.
      try {
        const track = this.stream.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() || {};
        const advanced = {};
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
        if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
        if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
        if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
      } catch (_) {}
      await new Promise((resolve, reject) => {
        if (video.readyState >= 1) return resolve();
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('The camera opened but the video preview could not start.')); };
        const cleanup = () => { video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      });
      await video.play();
      return true;
    },

    stopCamera(video) {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      if (video) video.srcObject = null;
    },

    async switchCamera(video) {
      this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
      return this.startCamera(video);
    },

    setOrientation(value) {
      this.orientation = value === 'portrait' ? 'portrait' : 'landscape';
      return this.orientation;
    },

    toggleOrientation() {
      return this.setOrientation(this.orientation === 'portrait' ? 'landscape' : 'portrait');
    },

    inspectFrame(video) {
      const vw = Number(video?.videoWidth || 0), vh = Number(video?.videoHeight || 0);
      if (!vw || !vh) {
        return { state: 'starting', ready: false, title: 'Camera is focusing…', text: 'Hold the phone steady and keep the paper in view.' };
      }

      // Live quality check: low-resolution enough to stay smooth on phones, but
      // large enough to see the printed registration markers and paper detail.
      const maxW = 520;
      const scale = Math.min(1, maxW / vw);
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (!this._assistCanvas) this._assistCanvas = document.createElement('canvas');
      const canvas = this._assistCanvas;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const grayAt = (x, y) => {
        const i = (y * w + x) * 4;
        return data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
      };

      let sum = 0, samples = 0, edge = 0, veryBright = 0, veryDark = 0;
      const step = 5;
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const g = grayAt(x, y);
          sum += g; samples++;
          if (g > 250) veryBright++;
          if (g < 28) veryDark++;
          edge += Math.abs(g - grayAt(x + step, y)) + Math.abs(g - grayAt(x, y + step));
        }
      }
      const mean = samples ? sum / samples : 0;
      const sharpness = samples ? edge / (samples * 2) : 0;
      const glare = samples ? veryBright / samples : 0;
      const darkRatio = samples ? veryDark / samples : 0;

      if (mean < 48) {
        return { state: 'warn', ready: false, title: 'Too dark to scan', text: 'Add soft light or move out of the shadow.', mean, sharpness };
      }
      if (glare > .26 && mean > 188) {
        return { state: 'warn', ready: false, title: 'Glare detected', text: 'Tilt the phone or move away from direct light.', mean, sharpness, glare };
      }
      if (sharpness < 3.5) {
        return { state: 'focus', ready: false, title: 'Image is not focused', text: 'Hold still and wait for the camera to focus.', mean, sharpness };
      }
      if (darkRatio > .35) {
        return { state: 'warn', ready: false, title: 'Paper is partly covered', text: 'Keep fingers and dark objects away from the answer sheet.', mean, sharpness };
      }

      try {
        const markers = this.findMarkers(canvas);
        return {
          state: 'ready', ready: true,
          title: 'Good to scan',
          text: 'Paper is visible and focused. Tap Capture & check.',
          markers, mean, sharpness, glare
        };
      } catch (err) {
        return {
          state: 'searching', ready: false,
          title: 'Not ready to scan',
          text: 'Show the entire answer sheet, including all four printed black corner marks.',
          mean, sharpness, reason: err?.message || ''
        };
      }
    },

    capture(video, canvas) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) throw new Error('Camera is not ready yet.');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      return canvas;
    },

    async captureBestFrame(video, canvas) {
      const track = this.stream?.getVideoTracks?.()[0];
      // On supported Android/Chromium devices, takePhoto can use a higher-quality
      // still image than the live preview. Fall back safely everywhere else.
      if (track && typeof window.ImageCapture === 'function') {
        try {
          const imageCapture = new ImageCapture(track);
          if (typeof imageCapture.takePhoto === 'function') {
            const blob = await imageCapture.takePhoto();
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));
            const max = 2600, scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
            return { canvas, blob, highQuality: true };
          }
        } catch (_) {}
      }
      this.capture(video, canvas);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .96));
      return { canvas, blob, highQuality: false };
    },

    async fileToCanvas(file, canvas) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const max = 2400, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return canvas;
    },

    findMarkers(canvas) {
      // Search the whole photo: a printed form can occupy only part of the
      // frame, and dark desks must not determine the paper's ink threshold.
      const scale=Math.min(1,1400/Math.max(canvas.width,canvas.height));
      const w=Math.round(canvas.width*scale), h=Math.round(canvas.height*scale);
      const temp=document.createElement('canvas');temp.width=w;temp.height=h;
      const ctx=temp.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data,gray=new Uint8Array(w*h);
      for(let i=0;i<gray.length;i++)gray[i]=rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114;
      const candidates=[],stack=new Int32Array(w*h);
      for(const threshold of [80,115,150,185]) {
        const seen=new Uint8Array(w*h);
        for(let seed=0;seed<gray.length;seed++) {
          if(seen[seed]||gray[seed]>threshold)continue;
          let length=1,area=0,minX=w,maxX=0,minY=h,maxY=0;
          stack[0]=seed;seen[seed]=1;
          while(length) {
            const i=stack[--length],x=i%w,y=Math.floor(i/w);area++;
            minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
            const neighbours=[x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1];
            for(const n of neighbours)if(n>=0&&!seen[n]){seen[n]=1;if(gray[n]<=threshold)stack[length++]=n;}
          }
          const bw=maxX-minX+1,bh=maxY-minY+1,fill=area/(bw*bh),ratio=bw/bh;
          if(area<20||Math.min(bw,bh)<4||Math.max(bw,bh)>Math.min(w,h)*.12||
             ratio<.60||ratio>1.67||fill<.82)continue;
          const c={x:(minX+maxX)/2,y:(minY+maxY)/2,side:Math.sqrt(area),fill,area};
          const old=candidates.find(o=>Math.hypot(o.x-c.x,o.y-c.y)<Math.min(o.side,c.side)*.45);
          if(old){if(c.fill>old.fill)Object.assign(old,c);}else candidates.push(c);
        }
      }
      const pool=candidates.sort((a,b)=>b.area-a.area).slice(0,24);
      let best=null;
      const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      for(let a=0;a<pool.length-3;a++)for(let b=a+1;b<pool.length-2;b++)
      for(let c=b+1;c<pool.length-1;c++)for(let d=c+1;d<pool.length;d++) {
        const points=[pool[a],pool[b],pool[c],pool[d]];
        const center={x:points.reduce((s,p)=>s+p.x,0)/4,y:points.reduce((s,p)=>s+p.y,0)/4};
        points.sort((a,b)=>Math.atan2(a.y-center.y,a.x-center.x)-Math.atan2(b.y-center.y,b.x-center.x));
        const sides=points.map((p,i)=>distance(p,points[(i+1)%4]));
        const short=Math.min(...sides),long=Math.max(...sides);
        if(short<Math.min(w,h)*.22||long/short>2.3||sides[0]/sides[2]<.6||sides[0]/sides[2]>1.67||sides[1]/sides[3]<.6||sides[1]/sides[3]>1.67)continue;
        const sizes=points.map(p=>p.side),meanSize=sizes.reduce((a,b)=>a+b)/4;
        if(Math.max(...sizes)/Math.min(...sizes)>1.9||meanSize/short<.017||meanSize/short>.057)continue;
        let area=0,convex=true;
        for(let i=0;i<4;i++) {
          const p=points[i],q=points[(i+1)%4],r=points[(i+2)%4];
          area+=p.x*q.y-p.y*q.x;
          if((q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x)<=0)convex=false;
        }
        if(!convex)continue;
        area=Math.abs(area)/2;
        const fit=Math.abs(meanSize/short-30/896);
        const score=area*(1-Math.min(.6,fit*12));
        if(!best||score>best.score)best={points,score};
      }
      if(!best)throw new Error('Cannot locate all four printed corner squares. Include the entire answer sheet and use a sharper, evenly lit photo.');
      // Geometric order only. analyze() tests all rotations/reflections against
      // printed item numbers before assigning the A/B/C/D choice coordinates.
      const points=best.points;
      const first=points.reduce((best,p,i)=>p.x+p.y<points[best].x+points[best].y?i:best,0);
      const clockwise=Array.from({length:4},(_,i)=>points[(first+i)%4]);
      return [clockwise[0],clockwise[1],clockwise[3],clockwise[2]].map((p,i)=>({x:p.x/scale,y:p.y/scale,name:['tl','tr','bl','br'][i]}));
    },

    solveHomography(dstPts, srcPts) {
      const A=[];
      for(let i=0;i<4;i++){
        const [x,y]=dstPts[i], [u,v]=srcPts[i];
        A.push([x,y,1,0,0,0,-u*x,-u*y,u]);
        A.push([0,0,0,x,y,1,-v*x,-v*y,v]);
      }
      for(let col=0;col<8;col++){
        let pivot=col; for(let r=col+1;r<8;r++) if(Math.abs(A[r][col])>Math.abs(A[pivot][col])) pivot=r;
        [A[col],A[pivot]]=[A[pivot],A[col]]; const div=A[col][col]; if(Math.abs(div)<1e-9) throw new Error('The paper is too tilted to read reliably. Hold the camera more directly above the sheet and try again.');
        for(let c=col;c<9;c++) A[col][c]/=div;
        for(let r=0;r<8;r++){ if(r===col)continue; const f=A[r][col]; for(let c=col;c<9;c++) A[r][c]-=f*A[col][c]; }
      }
      const h=A.map(r=>r[8]); h.push(1); return h;
    },

    map(H,x,y){ const d=H[6]*x+H[7]*y+H[8]; return {x:(H[0]*x+H[1]*y+H[2])/d, y:(H[3]*x+H[4]*y+H[5])/d}; },

    transformCanonicalPoint(x, y, transform = 'identity') {
      // The four registration squares are geometrically symmetric. Some mobile
      // browsers/cameras can therefore deliver a horizontally mirrored frame
      // without the markers revealing it. That exact failure makes A look like D
      // (and B like C). Keep the correction explicit so every downstream reader
      // uses the same canonical orientation.
      let u=(x-52)/896,v=(y-52)/1310;
      const mirrored=transform.startsWith('mirror');
      if(mirrored)u=1-u;
      const rotation=Number(transform.replace('mirror','').replace('rotate',''))||0;
      if(transform==='flipX')u=1-u;
      if(transform==='flipY')v=1-v;
      if(rotation===90)[u,v]=[1-v,u];
      if(rotation===180)[u,v]=[1-u,1-v];
      if(rotation===270)[u,v]=[v,1-u];
      return {x:52+u*896,y:52+v*1310};
    },

    extractNameRegion(canvas, H, orientationTransform = 'identity') {
      // Canonical GradeDock sheet coordinates for the handwritten Name line.
      // We intentionally stop just above the printed underline so OCR sees
      // mostly handwriting instead of a long horizontal rule.
      const x0 = 118, y0 = 142, x1 = 604, y1 = 190;
      const scale = 3;
      const out = document.createElement('canvas');
      out.width = Math.round((x1 - x0) * scale);
      out.height = Math.round((y1 - y0) * scale);
      const octx = out.getContext('2d', { willReadFrequently: true });
      const src = canvas.getContext('2d', { willReadFrequently: true });
      const srcImg = src.getImageData(0, 0, canvas.width, canvas.height);
      const dst = octx.createImageData(out.width, out.height);
      const sp = srcImg.data, dp = dst.data;

      for (let oy = 0; oy < out.height; oy++) {
        const cy = y0 + oy / scale;
        for (let ox = 0; ox < out.width; ox++) {
          const cx = x0 + ox / scale;
          const t = this.transformCanonicalPoint(cx, cy, orientationTransform);
          const p = this.map(H, t.x, t.y);
          const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(p.x)));
          const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(p.y)));
          const si = (sy * canvas.width + sx) * 4;
          const di = (oy * out.width + ox) * 4;
          const g = Math.round(sp[si] * .299 + sp[si + 1] * .587 + sp[si + 2] * .114);
          // Gentle contrast boost for pencil/pen handwriting while keeping paper white.
          const v = g < 205 ? Math.max(0, Math.round((g - 45) * 1.22)) : 255;
          dp[di] = dp[di + 1] = dp[di + 2] = v;
          dp[di + 3] = 255;
        }
      }
      octx.putImageData(dst, 0, 0);
      return out;
    },

    async readStudentName(canvas, H, orientationTransform = 'identity') {
      if (!window.Tesseract?.createWorker) {
        return { text: '', available: false, reason: 'OCR library unavailable' };
      }
      try {
        if (!this._ocrWorkerPromise) {
          this._ocrWorkerPromise = window.Tesseract.createWorker('eng').then(async worker => {
            await worker.setParameters({
              tessedit_pageseg_mode: '7',
              preserve_interword_spaces: '1',
              tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-"
            });
            return worker;
          });
        }
        const worker = await this._ocrWorkerPromise;
        const nameCanvas = this.extractNameRegion(canvas, H, orientationTransform);
        const result = await worker.recognize(nameCanvas);
        let text = String(result?.data?.text || '')
          .replace(/[_|]+/g, ' ')
          .replace(/[^A-Za-z .'-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Avoid filling obvious OCR noise into the name field.
        const letters = (text.match(/[A-Za-z]/g) || []).length;
        if (letters < 2) text = '';
        return { text, available: true, confidence: Number(result?.data?.confidence || 0), crop: nameCanvas };
      } catch (err) {
        console.warn('Name OCR failed:', err);
        return { text: '', available: true, reason: err?.message || 'Name OCR failed' };
      }
    },

    analyze(canvas, exam, answerKey=[]) {
      const markers = this.findMarkers(canvas);
      const src = markers.map(m => [m.x, m.y]);
      const L = window.GradeDockSheet.layout(Number(exam.question_count), Number(exam.choice_count));
      const dst = L.markers.map(m => [m.x, m.y]);
      const H = this.solveHomography(dst, src);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pix = image.data;

      // Clean reference sheet. It is used for two jobs:
      //   1) ignore the printed bubble outline/letters when measuring graphite/ink;
      //   2) detect a mirrored camera frame before reading answers.
      const reference = window.GradeDockSheet.renderCanvas({
        title: '',
        question_count: Number(exam.question_count),
        choice_count: Number(exam.choice_count)
      }, '', 1);
      const rctx = reference.getContext('2d', { willReadFrequently: true });
      const refData = rctx.getImageData(0, 0, reference.width, reference.height).data;

      const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, v));
      const quantile = (values, q) => {
        if (!values.length) return 0;
        const a = [...values].sort((x, y) => x - y);
        const pos = (a.length - 1) * q;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        if (lo === hi) return a[lo];
        const t = pos - lo;
        return a[lo] * (1 - t) + a[hi] * t;
      };
      const median = values => quantile(values, .5);

      // Bilinear sampling is noticeably more stable than rounding to one source
      // pixel when a phone photo is skewed. This reduces false choice shifts near
      // bubble edges after perspective correction.
      const grayAtSource = (x, y) => {
        x = clamp(x, 0, canvas.width - 1);
        y = clamp(y, 0, canvas.height - 1);
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const x1 = Math.min(canvas.width - 1, x0 + 1), y1 = Math.min(canvas.height - 1, y0 + 1);
        const tx = x - x0, ty = y - y0;
        const g = (xx, yy) => {
          const i = (yy * canvas.width + xx) * 4;
          return pix[i] * .299 + pix[i + 1] * .587 + pix[i + 2] * .114;
        };
        const a = g(x0,y0) * (1-tx) + g(x1,y0) * tx;
        const b = g(x0,y1) * (1-tx) + g(x1,y1) * tx;
        return a * (1-ty) + b * ty;
      };
      const grayAtReference = (x, y) => {
        const rx = Math.max(0, Math.min(reference.width - 1, Math.round(x)));
        const ry = Math.max(0, Math.min(reference.height - 1, Math.round(y)));
        const i = (ry * reference.width + rx) * 4;
        return refData[i] * .299 + refData[i + 1] * .587 + refData[i + 2] * .114;
      };

      // Estimate paper brightness from the captured page. We use a high quantile,
      // not a fixed 255, so shadows and slightly gray paper do not destroy the
      // contrast calculations.
      const pageBrightnessSamples = [];
      for (let y = 0; y < canvas.height; y += Math.max(10, Math.floor(canvas.height / 55))) {
        for (let x = 0; x < canvas.width; x += Math.max(10, Math.floor(canvas.width / 45))) {
          pageBrightnessSamples.push(grayAtSource(x, y));
        }
      }
      const pagePaper = Math.max(120, quantile(pageBrightnessSamples, .82));

      // The old scanner could read A as D when the camera feed was horizontally
      // mirrored. The four corner blocks cannot expose that because they are
      // symmetric. Detect the orientation from the asymmetric printed item-number
      // columns, then keep that correction for every bubble and OCR sample.
      const orientationScore = (transform) => {
        let score = 0, count = 0;
        const itemStep = Math.max(1, Math.floor(L.items.length / 22));
        for (let n = 0; n < L.items.length; n += itemStep) {
          const item = L.items[n];
          for (let dy = -8; dy <= 8; dy += 2) {
            for (let dx = -15; dx <= 15; dx += 2) {
              const cx = item.numberX + dx, cy = item.y + dy;
              const rg = grayAtReference(cx, cy);
              if (rg > 150) continue; // only compare known printed-number ink
              const t = this.transformCanonicalPoint(cx, cy, transform);
              const p = this.map(H, t.x, t.y);
              const sg = grayAtSource(p.x, p.y);
              const darkness = clamp((pagePaper - sg) / Math.max(65, pagePaper - 30));
              // Darker reference pixels carry slightly more weight.
              score += darkness * (1 + (150 - rg) / 180);
              count++;
            }
          }
        }
        return count ? score / count : 0;
      };
      const orientationCandidates = ['identity','rotate90','rotate180','rotate270','mirror0','mirror90','mirror180','mirror270']
        .map(transform => ({transform, score:orientationScore(transform)}))
        .sort((a,b)=>b.score-a.score);
      const winner=orientationCandidates[0], runnerUp=orientationCandidates[1];
      if (winner.score < .25 || winner.score-runnerUp.score < .12) {
        throw new Error('The printed item numbers are not clear enough to determine the sheet orientation. Use the matching GradeDock sheet, place it upright, and retake a sharper photo.');
      }
      const orientationTransform=winner.transform;
      const normalOrientationScore=orientationCandidates.find(x=>x.transform==='identity').score;
      const mirroredOrientationScore=orientationCandidates.find(x=>x.transform==='mirror0').score;

      const mapCanonical = (x, y) => {
        const t = this.transformCanonicalPoint(x, y, orientationTransform);
        return this.map(H, t.x, t.y);
      };

      // Register the printed circle outlines, never the student's chosen answer.
      // Row and individual-circle offsets stay below half the choice spacing.
      const rowOffsets = new Map();
      const bubbleOffsets = new Map();
      let alignedRows = 0;
      const ringFit=(b,ox,oy)=>{
        let sum=0;
        for(let k=0;k<24;k++){
          const angle=k*Math.PI/12;
          const sample=radius=>{
            const p=mapCanonical(b.x+ox+Math.cos(angle)*radius,b.y+oy+Math.sin(angle)*radius);
            return grayAtSource(p.x,p.y);
          };
          sum+=(sample(16)-sample(12))/255;
        }
        return sum/24;
      };
      // Paper curl can move a row more than a few pixels after a four-corner
      // warp. Search less than half a row/choice spacing, then refine each ring.
      const rowGap=L.rows>1?(L.rowBottom-L.rowTop)/(L.rows-1):48;
      const maxY=Math.min(18,Math.floor(rowGap*.36));
      for(const item of L.items){
        let best={score:-Infinity,x:0,y:0};
        const evaluate=(ox,oy)=>{
          const score=median(item.bubbles.map(b=>ringFit(b,ox,oy)))-.00002*(ox*ox+oy*oy);
          if(score>best.score)best={score,x:ox,y:oy};
        };
        for(let oy=-maxY;oy<=maxY;oy+=2)for(let ox=-16;ox<=16;ox+=2)evaluate(ox,oy);
        const coarse={...best};
        for(let oy=coarse.y-1;oy<=coarse.y+1;oy++)for(let ox=coarse.x-1;ox<=coarse.x+1;ox++)evaluate(ox,oy);
        rowOffsets.set(item.number,best);
        if(best.score>.10)alignedRows++;
        for(const bubble of item.bubbles){
          let fit={score:-Infinity,x:best.x,y:best.y};
          for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
            const score=ringFit(bubble,best.x+dx,best.y+dy)-.001*(dx*dx+dy*dy);
            if(score>fit.score)fit={score,x:best.x+dx,y:best.y+dy};
          }
          bubbleOffsets.set(bubble,fit);
        }
      }
      if (alignedRows < Math.ceil(L.items.length * .70)) {
        throw new Error('The answer circles do not line up clearly with this exam. Check the selected exam/item count, flatten the paper, and retake a sharper photo with all four corner squares visible.');
      }

      const bubbleInk = (cx, cy, offset) => {
        const sample = (dx,dy) => {
          const p = mapCanonical(cx + offset.x + dx, cy + offset.y + dy);
          return grayAtSource(p.x,p.y);
        };
        const bg = [];
        for (let k=0;k<32;k++) {
          const angle=k*Math.PI/16;
          bg.push(sample(17*Math.cos(angle),17*Math.sin(angle)));
        }
        const paper = quantile(bg,.75);
        const span = Math.max(60,paper-25);
        let count=0, dark=0, contrast=0;
        const sectors=Array.from({length:4},()=>({n:0,dark:0}));
        // Use identical writable areas for A through E. Exclude the entire
        // printed-letter rectangle (PDF/PNG/browser fonts differ), plus the
        // circle boundary. Do not hunt for the darkest neighbouring pixels.
        for(let dy=-9;dy<=9;dy++) for(let dx=-9;dx<=9;dx++) {
          if(dx*dx+dy*dy>90.25 || (Math.abs(dx)<=5.5 && Math.abs(dy)<=7.5)) continue;
          const delta=Math.max(0,paper-sample(dx,dy));
          const marked=delta>Math.max(22,span*.14);
          const sector=(dy>=0?2:0)+(dx>=0?1:0);
          sectors[sector].n++;
          if(marked){dark++;sectors[sector].dark++;}
          contrast+=clamp(delta/span);
          count++;
        }
        const coverage=count?dark/count:0;
        const meanContrast=count?contrast/count:0;
        const supportedSectors=sectors.filter(s=>s.n && s.dark/s.n>=.30).length;
        return {score:.70*coverage+.30*meanContrast, coverage, meanContrast,
          supportedSectors, paper, total:count};
      };
      const measured=L.items.map(item=>({item,raw:item.bubbles.map(b=>{
        const metric=bubbleInk(b.x,b.y,bubbleOffsets.get(b));
        return {choice:b.choice,score:metric.score,metric};
      })}));
      const markThreshold=.16, lightMarkThreshold=.24, strongMarkThreshold=.40;
      const discriminationMargin=.14;
      const noise=0, globalBase=0;

      const detected = [];
      let uncertain = 0, correct = 0;

      for (const row of measured) {
        const scores = row.raw.map(x => ({...x,rawScore:x.score})).sort((a,b)=>b.score-a.score);
        const best=scores[0], second=scores[1];
        const margin=best.score-second.score;
        const hasMark = x => x.score>=lightMarkThreshold &&
          x.metric.coverage>=.30 && x.metric.supportedSectors>=2;
        let answer='', state='blank';
        if (hasMark(best) && hasMark(second)) {
          // Two marks remain unresolved even if one is darker. Never choose
          // an answer based on the answer key or silently pick the darkest.
          state='multiple';
        } else if (hasMark(best)) {
          answer=best.choice;
          state=best.score>=strongMarkThreshold && margin>=discriminationMargin &&
            best.metric.coverage>=.50 && best.metric.supportedSectors>=3 ? 'ok' : 'low';
        } else if (best.score>=markThreshold) {
          state='low';
        }
        if (rowOffsets.get(row.item.number).score <= .10) {
          answer=''; state='low';
        }
        if (state!=='ok') uncertain++;

        const key = answerKey[row.item.number - 1] || '';
        const isCorrect = state === 'ok' && answer === key;
        if (isCorrect) correct++;
        detected.push({
          question: row.item.number,
          answer,
          key,
          isCorrect,
          state,
          scores,
          thresholds: {
            mark: markThreshold,
            light: lightMarkThreshold,
            strong: strongMarkThreshold,
            discrimination: discriminationMargin
          }
        });
      }

      const confidence = Math.round(100 * (L.items.length - uncertain) / L.items.length);
      return {
        markers,
        answers: detected,
        correct,
        total: L.items.length,
        percentage: Math.round(correct / L.items.length * 10000) / 100,
        uncertain,
        confidence,
        homography: H,
        orientationTransform,
        cameraMirrorCorrected: orientationTransform !== 'identity',
        orientationScores: { normal: normalOrientationScore, mirrored: mirroredOrientationScore },
        alignment: { alignedRows, totalRows: L.items.length },
        sensitivity: {
          markThreshold,
          lightMarkThreshold,
          strongMarkThreshold,
          discriminationMargin,
          noise,
          globalBase
        }
      };
    }
  };
  window.GradeDockScanner=Scanner;
})();
