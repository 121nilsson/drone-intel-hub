# Canonical concept reference (Phase 3.2)

These are the ONLY valid `canonical_id` values for this evaluation frame.

- Snapshot id `snap-code-seed-v1`; hash `c1494d11c0555a4d4b6b8a7e46c17fd35debfda3a9ab36119ecef0a1db23d19f`
- Manifest version 1.0.0; catalog schema 1.0.0
- Concepts 42 across 14 families

The reference is derived from the frozen snapshot's rule set, not from the live registry.
To report a meaningful concept that is missing here, use `verdict=registry_gap` and describe
it in `note`; do not guess an id. See `docs/semantic-review-protocol.md`.

## altitude

- `altitude.max` — Maximum Altitude — Absolute operational ceiling
  - Also matched here: max_altitude, maximum_altitude, operational_altitude
- `altitude.service_ceiling` — Service Ceiling — Aeronautical ceiling (climb rate decay bound)
  - Also matched here: service_ceiling
- `altitude.target_max` — Max Target Altitude — Ceiling of engageable target (C-UAS)
- `altitude.target_min` — Min Target Altitude — Floor of engageable target (C-UAS)

## capacity

- `capacity.fuel` — Fuel Capacity — Internal liquid fuel volume
  - Also matched here: capacity
- `capacity.target_channels` — Target Channels — Simultaneous target tracking/engagement channels
  - Also matched here: capacity

## cost

- `cost.unit` — Unit Cost — Procurement price per unit

## dimension

- `dimension.caliber` — Caliber — Bore or munition caliber
- `dimension.depth` — Draft/Depth — Subsurface draft or depth
- `dimension.diameter` — Diameter — Fuselage or body diameter
- `dimension.height` — Height — Overall height
- `dimension.length` — Length — Overall airframe/hull length
- `dimension.width` — Width — Beam or fuselage width
  - Also matched here: beam
- `dimension.wingspan` — Wingspan — Total wing span
  - Also matched here: wing_span, wingspan

## endurance

- `endurance.flight` — Flight Endurance — Total operating duration in flight
  - Also matched here: endurance, flight_endurance

## guidance

- `guidance.system` — Guidance System — Navigation and terminal homing technology

## inventory

- `inventory.deployed_count` — Deployed Units — Active operational inventory count

## maneuver

- `maneuver.load_factor_max` — Max Load Factor — Normal structural acceleration limit (g)
  - Also matched here: g_limit, load_factor, max_g

## payload

- `payload.capacity` — Payload Capacity — Maximum carrying capacity for equipment/stores
  - Also matched here: capacity, max_payload, payload_capacity
- `payload.mass` — Payload Mass — Nominal carried payload weight
- `payload.warhead` — Warhead Mass — Net explosive charge weight
  - Also matched here: warhead_mass, warhead_weight

## power

- `power.engine` — Engine Power — Propulsion motor or engine output
  - Also matched here: engine_power, power
- `power.rf` — RF Jamming Power — Transmitter/jammer output power
  - Also matched here: jamming_power, power

## production

- `production.rate_monthly` — Monthly Production — Manufacturing output per month

## range

- `range.combat` — Combat Range — Mission range under combat load
- `range.combat_radius` — Combat Radius — Outbound-only combat mission radius
  - Also matched here: combat_radius, radius
- `range.detection` — Detection Range — Sensor detection distance
- `range.engagement` — Engagement Range — Effective engagement or suppression envelope (C-UAS)
  - Also matched here: radius
- `range.ferry` — Ferry Range — Maximum range without payload/stores
- `range.fiber_spool` — Fiber Spool Length — Physical tether or optical fiber payout length
- `range.link` — Link/Control Range — Line-of-sight communication or data link limit
- `range.max` — Maximum Range — Maximum stated operational or ferry range
  - Also matched here: max_range, maximum_range
- `range.min` — Minimum Range — Minimum arming, engagement or operating distance
- `range.operational` — Operational Range — Practical range under mission load

## speed

- `speed.cruise` — Cruise Speed — Nominal sustained cruise airspeed
  - Also matched here: cruise_speed, cruising_speed, speed_cruise
- `speed.dive` — Dive Speed — Terminal dive or never-exceed speed (Vne)
- `speed.max` — Maximum Speed — Highest rated or demonstrated airspeed
  - Also matched here: max_speed, maximum_speed, top_speed, vmax
- `speed.target_max` — Max Target Speed — Maximum engageable target speed (C-UAS)

## weight

- `weight.empty` — Empty Weight — Airframe weight without fuel or payload
- `weight.launch` — Launch Weight — Total weight at moment of launch
- `weight.mtow` — MTOW — Maximum takeoff weight
  - Also matched here: max_takeoff_weight, mtow
- `weight.total` — Total Weight — Stated gross system weight
  - Also matched here: total_weight, weight
