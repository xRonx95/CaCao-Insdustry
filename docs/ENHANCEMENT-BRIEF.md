# CACAO INDUSTRY — COMPLETE SYSTEM ENHANCEMENT PROMPT

Act as a Senior Full-Stack Developer, GIS Specialist, Agricultural Information Systems Analyst, and Database Security Engineer.

Enhance my existing Cacao Industry Farmer Profiling and GPS Plantation Mapping System for Isabela City, Basilan, Philippines.

IMPORTANT: Inspect all existing project files before making changes. Preserve working GPS mapping, polygon editing, SQM calculations, and GeoJSON export features.

Use HTML5, CSS3, Vanilla JavaScript, Leaflet.js, Turf.js, Supabase PostgreSQL, Supabase Authentication, Supabase Storage, and PostGIS where supported.

Do not convert this project to React, Next.js, PHP, or Laravel.

## PRIORITY 1 — FARMER AND PLANTATION MANAGEMENT

Implement:
- Farmer registration and editing
- Automatically generated farmer IDs
- Optional RSBSA reference numbers
- Duplicate farmer detection
- Multiple plantations per farmer
- Plantation registration and editing
- Farmer photograph uploads
- Secure document uploads
- Farmer verification statuses
- Plantation verification statuses
- Registration history
- Barangay-based farmer filtering
- Complete farmer and plantation search

## PRIORITY 2 — ADVANCED GPS MAPPING

Enhance the existing GPS Walking and Polygon Drawing modules.

Required:
- Live GPS tracking
- GPS accuracy indicator
- High-accuracy GPS positioning when supported
- Pause, Resume, Finish, and Cancel
- GPS point filtering and validation
- Automatic SQM and hectare calculation
- Manual polygon editing
- Polygon self-intersection detection
- Overlapping plantation boundary detection
- Multiple plantation parcels per farmer
- GPS mapping session history
- Automatic local recovery of interrupted sessions
- Boundary version history
- Plantation mapping approval process
- GeoJSON export and import
- Preserve original recorded GPS points

Use IndexedDB for persistent offline drafts and session recovery.

For plantation overlap detection, distinguish genuine overlapping areas from shared boundaries and touching edges. Flag potential conflicts for administrator review rather than automatically rejecting them.

Use PostGIS for server-side geometry validation and area calculations where available.

## PRIORITY 3 — CACAO TREE INVENTORY

Implement:
- Total cacao trees
- Cacao variety
- Tree age
- Seedlings
- Young trees
- Mature trees
- Productive trees
- Non-productive trees
- Dead trees
- Tree mortality records
- Tree planting history
- Tree replacement records
- Tree inventory history
- Optional GPS tagging for individual trees

Prevent conflicting inventory totals by clearly defining whether tree age groups and production statuses are overlapping classifications.

## PRIORITY 4 — HARVEST AND PRODUCTION MONITORING

Create a new agricultural production module.

Fields:
- Harvest ID
- Plantation ID
- Harvest Date
- Cacao Variety
- Number of Harvested Pods
- Wet Bean Weight (kg)
- Dry Bean Weight (kg)
- Estimated Production Value
- Recorded By
- Remarks

Include:
- Monthly production reports
- Annual production reports
- Production per plantation
- Production per hectare
- Harvest history
- Harvest trends
- Production statistics
- Exportable reports

## PRIORITY 5 — PEST AND DISEASE MONITORING

Create:
- Pest and disease reporting
- Affected plantation
- Date observed
- Pest or disease name
- Severity level
- Estimated affected trees
- Photographic evidence
- Treatment records
- Follow-up inspection
- Resolution status

## PRIORITY 6 — FARM MAINTENANCE AND WORKERS

Implement:
- Worker registration
- Worker assignments
- Daily attendance
- Plantation tasks
- Pruning schedules
- Fertilizer application records
- Irrigation records
- Maintenance history
- Worker activity reports

## PRIORITY 7 — ADMINISTRATIVE DASHBOARD

Provide:
- Total registered farmers
- Total registered plantations
- Total mapped SQM
- Total mapped hectares
- Total cacao trees
- Total workers
- Total harvested cacao beans
- Pending registrations
- Pending plantation verifications
- Recent GPS mapping activities
- Plantation distribution by barangay
- Interactive GIS plantation map
- Production monitoring charts

All statistics must come from the Supabase database.

## PRIORITY 8 — SECURITY AND DATA INTEGRITY

Implement:
- Supabase Authentication
- Secure role-based access
- Supabase RLS policies
- Administrator verification
- Audit trail
- Secure document storage
- Input validation
- Duplicate record prevention
- Database backup and recovery procedures
- Privacy-compliant farmer data collection
- Safe file uploads
- Server-side validation of mapping records
- Database constraints and indexes

Never expose Supabase secret keys or service-role keys in frontend code.

## PRIORITY 9 — OFFLINE FIELD OPERATIONS

Implement:
- IndexedDB offline storage
- Offline farmer profile drafts
- Offline GPS mapping sessions
- Pending record synchronization
- Automatic retry after reconnection
- Duplicate-safe synchronization
- Synchronization status dashboard
- Clear conflict resolution
- Safe recovery from interrupted submissions

Do not delete local drafts until successful server synchronization is confirmed.

## PRIORITY 10 — TESTING AND DEPLOYMENT

Implement:
- GPS coordinate validation tests
- Area calculation tests
- Invalid polygon tests
- Boundary overlap tests
- Authentication tests
- RLS authorization tests
- Offline synchronization tests
- Mobile responsive tests
- Browser compatibility checks
- Farmer and plantation CRUD tests

Create deployment instructions for:
- GitHub
- Vercel
- Supabase
- HTTPS GPS permissions
- Future Capacitor Android packaging

## IMPLEMENTATION INSTRUCTIONS

Work on one development phase at a time.

First inspect the existing source code and identify:
1. Which features are already working.
2. Which features are partially implemented.
3. Which required features are missing.
4. Which database tables need to be added.
5. Which security improvements are necessary.

Preserve all current working features.

Then implement the highest-priority missing modules.

For each phase, generate complete HTML, CSS, JavaScript, and Supabase SQL files.

Do not create placeholder buttons, simulated database saves, or unfinished functions.

Test the implemented features before proceeding to the next phase.

The final system must be professional, responsive, secure, and suitable for real agricultural field data collection and plantation monitoring.