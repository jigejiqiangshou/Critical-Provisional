import { chromium } from '@playwright/test'
import { preview } from 'vite'

const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } })
try {
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('Vite preview did not bind a loopback URL')

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  const browser = await chromium.launch({ executablePath })
  try {
    const page = await browser.newPage()
    const response = await page.goto(url)
    if (!response?.ok()) throw new Error(`Vite preview failed to serve ${url} (${response?.status()})`)

    const frame = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      document.body.append(canvas)
      const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
      if (!gl) throw new Error('Chromium did not create a WebGL 2 context')

      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('WebGL 2 did not allocate a shader')
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(`WebGL 2 shader compilation failed: ${gl.getShaderInfoLog(shader)}`)
        }
        return shader
      }

      const program = gl.createProgram()
      if (!program) throw new Error('WebGL 2 did not allocate a program')
      gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
        const vec2 vertices[3] = vec2[3](vec2(-0.75, -0.75), vec2(0.75, -0.75), vec2(0, 0.75));
        void main() { gl_Position = vec4(vertices[gl_VertexID], 0, 1); }
      `))
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
        precision mediump float;
        out vec4 color;
        void main() { color = vec4(0, 1, 0, 1); }
      `))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`WebGL 2 program linking failed: ${gl.getProgramInfoLog(program)}`)
      }
      gl.useProgram(program)

      await new Promise(requestAnimationFrame)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      const readPixel = (x: number, y: number) => {
        const rgba = new Uint8Array(4)
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
        return Array.from(rgba)
      }
      const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        webgl: gl.getParameter(gl.VERSION),
        renderer: gl.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        centerRgba: readPixel(32, 32),
        cornerRgba: readPixel(0, 0),
        error: gl.getError(),
      }
    })

    console.log(JSON.stringify({ chromium: browser.version(), ...frame }, null, 2))
    if (frame.error !== 0 || frame.centerRgba.join() !== '0,255,0,255' || frame.cornerRgba.join() !== '0,0,0,255') {
      throw new Error('WebGL 2 did not render the expected triangle and background pixels')
    }
    console.log('Cloud WebGL preflight passed')
  } finally {
    await browser.close()
  }
} finally {
  await server.close()
}
