-- SparkleBurst: 1024x1024 ParticleEmitter flipbook, 16 frames in a 4x4 grid
-- Upload the PNG, then set these on the ParticleEmitter (FlipbookFramerate max is 30).
emitter.Texture = "rbxassetid://0" -- replace with the uploaded image id
emitter.FlipbookLayout = Enum.ParticleFlipbookLayout.Grid4x4
emitter.FlipbookMode = Enum.ParticleFlipbookMode.OneShot -- Loop | OneShot | PingPong | Random
emitter.FlipbookFramerate = NumberRange.new(24)
