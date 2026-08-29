const mode = process.env.DSH_DESKTOP_FIXTURE_MODE

if (mode === 'exit') {
  process.stderr.write('fixture exited before readiness\n')
  process.exit(7)
}

if (mode === 'hang') {
  setInterval(() => {}, 1_000)
} else {
  process.stdout.write('noise before readiness\n')
  process.stdout.write('dsh web: http://127.0.0.1:43123\n')
  process.on('message', (message) => {
    if (message !== 'dsh/supervisor-shutdown') return
    if (mode === 'stubborn') {
      process.stdout.write('shutdown requested\n')
      return
    }
    process.exit(0)
  })
  setInterval(() => {}, 1_000)
}
