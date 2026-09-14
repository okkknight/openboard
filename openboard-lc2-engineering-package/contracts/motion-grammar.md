# Construction Motion Grammar

Motion is downstream of `RenderOperation`; it never invents semantic states.

| Family | ENTER | UPDATE | EXIT | Fallback |
|---|---|---|---|---|
| bar/rect | baseline/zero -> target | x/y/w/h tween | target -> baseline | fade |
| dot/circle | r/scale 0 -> target | cx/cy/r tween | r/scale -> 0 | fade |
| rule | draw from endpoint | endpoint tween | retract | fade |
| text | short opacity/translate | position/content update | fade | immediate |
| arc | angle sweep | angle/radius interpolation | angle collapse | fade |
| line | stroke draw/fade | path interpolation if safe, else within-layer crossfade | erase/fade | layer crossfade |
| area | baseline/fade | path interpolation if safe, else within-layer crossfade | collapse/fade | layer crossfade |

## Global rules

- default duration: 160–320 ms;
- stagger only for ENTER and cap total stagger around 120 ms;
- disable or compress stagger for high mark counts;
- motion is cancellable by a newer generation;
- stale generations may not mutate DOM;
- reduced motion keeps semantic reconciliation but removes decorative movement;
- no `sleep`, fake progress, or delayed playback.
