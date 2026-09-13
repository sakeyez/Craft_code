const video = document.querySelector('video')
window.startCapture = async () => {
  video.srcObject = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 10, max: 10 } } })
  await video.play()
}
window.captureFrame = async crop => {
  const started = performance.now()
  await new Promise((resolve, reject) => {
    const callback = video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve() })
    const timer = setTimeout(() => { video.cancelVideoFrameCallback(callback); reject(new Error('没有新鲜的游戏帧')) }, 650)
  })
  const received = performance.now()
  const width = video.videoWidth * crop.width, height = video.videoHeight * crop.height
  if (width <= 0 || height <= 0) throw new Error('游戏帧为空')
  const scale = Math.min(1, 1920 / width, 1080 / height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width * scale)); canvas.height = Math.max(1, Math.floor(height * scale))
  canvas.getContext('2d').drawImage(video, video.videoWidth * crop.x, video.videoHeight * crop.y, width, height, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvas.toDataURL('image/jpeg', .75)
  console.debug(`annotation timing frame=${(received - started).toFixed(1)}ms encode=${(performance.now() - received).toFixed(1)}ms`)
  return { dataUrl, width: canvas.width, height: canvas.height }
}
