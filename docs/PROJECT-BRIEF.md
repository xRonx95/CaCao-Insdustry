# PROJECT PROMPT: CACAO INDUSTRY FARMER PROFILING AND GPS PLANTATION MAPPING SYSTEM

## 1. PROJECT OVERVIEW

Act as a Senior Full-Stack Web Developer, GIS Developer, Database Architect, and Professional UI/UX Designer.

Develop a complete, professional, responsive, and production-ready web-based **Cacao Industry Farmer Profiling, Plantation Mapping, and Monitoring System** for Isabela City, Basilan, Philippines.

The system must allow authorized administrators, field personnel, and registered cacao farmers to record farmer profiles, register cacao plantations, capture GPS coordinates, draw plantation boundaries, automatically calculate land area in square meters (m²) and hectares (ha), record cacao trees, manage workers, and generate agricultural reports.

The system should follow a farmer profiling and agricultural land georeferencing workflow inspired by the Philippine Department of Agriculture's Registry System for Basic Sectors in Agriculture (RSBSA).

This is an independent cacao management system, not an official PSA or DA government system.

## 2. REQUIRED TECHNOLOGY STACK

Frontend:
- HTML5
- CSS3
- Vanilla JavaScript (ES6+)
- Responsive design for desktop, tablet, and mobile
- Leaflet.js for interactive maps
- Leaflet-Geoman or Leaflet Draw for plantation polygons
- Turf.js for geographic area calculation
- Chart.js for dashboard statistics
- Lucide icons

Backend and Database:
- Supabase PostgreSQL
- Supabase Authentication
- Supabase Storage for farmer photos and supporting documents
- Supabase Row Level Security (RLS)

Deployment:
- GitHub for version control
- Vercel for hosting
- HTTPS for secure GPS access

Future Android Support:
- Capacitor for packaging the web application as an Android app
- Android GPS and location permissions
- Offline data collection and synchronization

Do not use React, Next.js, PHP, or Laravel.

Use separate HTML, CSS, and JavaScript files with reusable modules and organized folders.

## 3. USER ROLES

### Super Administrator
- Manage all system users.
- Create administrator and field personnel accounts.
- Approve farmer registrations.
- View all registered farmers and plantations.
- Manage crop and plantation records.
- View system-wide statistics.
- Generate comprehensive reports.
- Review GPS mapping records.
- Monitor user activity logs.

### Administrator
- Manage assigned farmers and plantations.
- View plantation locations.
- Validate farmer information.
- Manage worker records.
- Generate agricultural reports.
- Review farmer registration requests.

### Field Personnel
- Register farmers during field visits.
- Capture farmer GPS locations.
- Walk around plantation boundaries using GPS.
- Draw plantation polygons manually.
- Record cacao trees and plantation conditions.
- Upload geotagged farm photographs.
- Submit records for administrator validation.

### Farmer
- View their own profile.
- Register their plantations.
- View mapped plantation boundaries.
- View total land area.
- Manage cacao tree inventories.
- View assigned workers.
- Update permitted farming information.

Enforce all role permissions using Supabase RLS, not just hidden frontend buttons.

## 4. MAIN SYSTEM MODULES

### MODULE 1: AUTHENTICATION

Create a professional login page with:
- Email and password
- Show/hide password
- Forgot password
- Supabase authentication
- Role-based dashboard redirection
- Account status validation
- Secure logout

Protect all dashboard pages from unauthorized users.

### MODULE 2: PROFESSIONAL DASHBOARD

Display overview cards showing:
- Total Registered Farmers
- Total Cacao Plantations
- Total Cacao Trees
- Total Plantation Area (m²)
- Total Plantation Area (ha)
- Total Registered Workers
- Active Plantations
- Pending Farmer Registrations

Include:
- Farmer registration chart
- Plantation distribution chart
- Cacao tree growth statistics
- Recent activity records
- Interactive plantation location map
- Barangay-based agricultural statistics

The dashboard should automatically retrieve real data from Supabase.

Do not hardcode statistics.

### MODULE 3: FARMER PROFILING

Create a farmer registration form.

Personal Information:
- Farmer ID (automatically generated)
- First Name
- Middle Name
- Last Name
- Gender
- Birth Date
- Contact Number
- Email Address
- Complete Address
- Barangay
- City/Municipality
- Province
- Profile Photo

Agricultural Information:
- RSBSA Number (optional)
- Farming Experience
- Farmer Category
- Land Tenure Status
- Number of Plantations
- Primary Cacao Variety
- Registration Date
- Registration Status

Important:
- Support multiple plantations per farmer.
- Store farmer photographs securely.
- Validate mandatory fields.
- Allow editing farmer information.
- Provide searchable farmer directories.
- Include filters and pagination.
- Prevent unauthorized access to personal information.

### MODULE 4: GPS PLANTATION MAPPING

This is one of the MOST IMPORTANT features.

Create a professional interactive map using Leaflet.js and a configurable map tile provider.

Support two plantation mapping methods.

METHOD A: GPS WALKING

The field personnel or farmer should be able to:

1. Open the plantation mapping page.
2. Select an existing farmer.
3. Click "Start GPS Mapping".
4. Grant browser location permission.
5. Walk around the cacao plantation boundary.
6. Record GPS coordinates as they move.
7. Display the current GPS position on the map.
8. Display the walked boundary as a line.
9. Show GPS accuracy in meters.
10. Provide buttons for Pause, Resume, Finish, and Cancel.
11. Allow the user to review and correct the captured boundary.
12. Close the polygon when mapping is finished.
13. Automatically calculate the enclosed land area.
14. Save the polygon coordinates in Supabase.

Technical requirements:
- Use navigator.geolocation.watchPosition().
- Enable high-accuracy GPS when supported.
- Track latitude, longitude, timestamp, and reported accuracy.
- Reject invalid coordinates.
- Warn about inaccurate GPS readings.
- Filter GPS points with excessive horizontal error.
- Prevent duplicate or near-identical points.
- Require at least three valid distinct polygon vertices.
- Detect polygon self-intersections.
- Allow the user to edit points before saving.
- Handle GPS permission denial and unavailable positioning.
- Display loading, error, and success states.
- Properly clear geolocation watchers when tracking stops.

METHOD B: MANUAL POLYGON DRAWING

Allow the user to:
- Open the plantation map.
- Search or navigate to the plantation location.
- Select "Draw Plantation Boundary".
- Add polygon vertices by clicking on the map.
- Move, add, or delete polygon points.
- Automatically close the plantation polygon.
- Calculate the polygon area.
- Edit an existing polygon.
- Save the finalized boundary.

Use Leaflet-Geoman or an equivalent supported library.

### MODULE 5: AUTOMATIC LAND AREA CALCULATION

Use Turf.js to calculate geographic polygon area.

Show the result in:

Square Meters:
5,000 m²

Hectares:
0.5000 ha

Conversion:
1 hectare = 10,000 square meters.

Important:
- Calculate area from polygon coordinates, not from a map screenshot.
- Use Turf.js area() on a valid GeoJSON polygon.
- Ensure polygons use GeoJSON coordinate order [longitude, latitude].
- Preserve sufficient decimal precision.
- Store area in square meters in the database.
- Derive hectares by dividing square meters by 10,000.
- Recalculate the area whenever a plantation boundary changes.
- Clearly label GPS-based measurements as approximate and not a legal cadastral survey.
- Store the original GPS accuracy information when available.

### MODULE 6: CACAO PLANTATION REGISTRATION

Plantation Details:
- Plantation ID
- Farmer ID
- Plantation Name
- Barangay
- City/Municipality
- Province
- Plantation Address
- Latitude
- Longitude
- GPS Boundary Polygon
- Land Area (m²)
- Land Area (ha)
- Land Tenure Status
- Plantation Establishment Date
- Cacao Variety
- Total Cacao Trees
- Productive Trees
- Non-Productive Trees
- Dead Trees
- Plantation Status
- Plantation Photo

A farmer can register more than one plantation.

Each plantation must have its own polygon boundary.

Allow administrators to verify plantation information.

### MODULE 7: CACAO TREE INVENTORY

Track the number and condition of cacao trees.

Fields:
- Plantation ID
- Cacao Variety
- Total Trees
- Seedling Trees
- Young Trees
- Mature Trees
- Productive Trees
- Non-Productive Trees
- Dead Trees
- Date of Inventory
- Recorded By
- Remarks

Display statistics for each plantation.

Allow updated tree inventory records without deleting historical inventory data.

### MODULE 8: WORKER PROFILING

Create a worker registration and management module.

Fields:
- Worker ID
- First Name
- Middle Name
- Last Name
- Gender
- Contact Number
- Address
- Assigned Plantation
- Employment Type
- Job Position
- Start Date
- Employment Status
- Worker Photo

Support workers assigned to multiple plantations.

Record worker assignments separately from worker personal information.

### MODULE 9: INTERACTIVE PLANTATION MAP

Create a full-page interactive agricultural GIS map.

Required features:
- Show all authorized cacao plantations.
- Display plantation polygon boundaries.
- Show plantation location markers.
- Zoom in and out.
- Display map scale.
- Provide a barangay filter.
- Provide a farmer filter.
- Provide a plantation status filter.
- Click a polygon to view plantation details.
- Show farmer name, plantation name, area, and cacao tree count.
- Fit the map to plantation boundaries.
- Offer street map and imagery layers when a licensed imagery provider is configured.

Use distinct polygon colors for different plantation statuses.

Do not expose private farmer data to unauthorized users.

### MODULE 10: REPORTS AND ANALYTICS

Create professional printable reports:
- Farmer Master List
- Plantation Registry
- Total Cacao Plantation Area
- Area by Barangay
- Cacao Tree Inventory
- Worker Registry
- Plantation Status Report
- Farmer Distribution Report
- Annual Cacao Industry Statistics

Report features:
- Date range filters
- Barangay filters
- Farmer search
- Printable page layouts
- CSV export
- PDF export
- Summary charts
- Generated date and time in Asia/Manila

Make reports suitable for local agricultural offices, cooperatives, and cacao industry organizations.

### MODULE 11: AUDIT LOGS

Record important system activities:
- Farmer creation
- Farmer profile updates
- Plantation registration
- Plantation polygon updates
- Tree inventory updates
- Worker assignments
- Administrative approvals
- User account changes

Each activity should contain:
- User ID
- Action Type
- Record Type
- Record ID
- Timestamp
- Relevant change details

Prevent ordinary users from modifying audit logs.

## 5. SUPABASE DATABASE DESIGN

Create a complete PostgreSQL schema containing at least these tables:

1. profiles
2. farmers
3. plantations
4. plantation_boundaries
5. gps_tracking_sessions
6. gps_tracking_points
7. cacao_tree_inventories
8. workers
9. worker_assignments
10. plantation_photos
11. farmer_documents
12. activity_logs

Database requirements:
- UUID primary keys where appropriate
- Correct foreign key relationships
- created_at and updated_at columns
- Appropriate unique constraints
- Database indexes
- Data validation constraints
- Supabase RLS policies
- Role-based authorization
- Secure storage policies
- Database functions and triggers where appropriate

Use PostGIS for storing and querying plantation boundaries when available.

Store validated GeoJSON boundaries as geographic data.

Calculate authoritative stored plantation areas on the server/database side to prevent clients from submitting fabricated area totals.

Never place a Supabase service_role key or secret key in frontend JavaScript.

Use only the public publishable/anon key in browser configuration, protected by strong database RLS policies.

All privileged operations must be performed securely through an authorized backend mechanism.

## 6. PROJECT FOLDER STRUCTURE

Use the following organization:

cacao-industry/
- index.html
- login.html
- register.html
- vercel.json
- README.md
- .gitignore
- .env.example
- assets/
  - css/
    - global.css
    - auth.css
    - dashboard.css
    - farmers.css
    - plantations.css
    - mapping.css
    - workers.css
    - reports.css
    - responsive.css
  - js/
    - config.js
    - supabase-client.js
    - auth.js
    - permissions.js
    - dashboard.js
    - farmers.js
    - plantations.js
    - gps-mapping.js
    - polygon-drawing.js
    - area-calculator.js
    - tree-inventory.js
    - workers.js
    - reports.js
    - utils.js
  - img/
    - logo.png
    - default-avatar.png
- admin/
  - dashboard.html
  - farmers.html
  - plantations.html
  - mapping.html
  - workers.html
  - reports.html
  - users.html
  - settings.html
- field/
  - dashboard.html
  - register-farmer.html
  - gps-mapping.html
  - plantation-inventory.html
- farmer/
  - dashboard.html
  - profile.html
  - plantations.html
  - trees.html
- database/
  - schema.sql
  - rls-policies.sql
  - storage-policies.sql
  - sample-data.sql

Add additional files and modules where necessary.

## 7. PROFESSIONAL USER INTERFACE

Design a modern agricultural management dashboard.

Design Style:
- Professional government/agricultural information system
- Clean and formal layout
- Responsive dashboard
- Smooth transitions
- Accessible controls
- Clear navigation
- Consistent typography

Color Palette:
- Dark Forest Green: #173D2B
- Primary Green: #287A4B
- Cacao Brown: #754C32
- Light Green: #EAF5EC
- Background: #F5F7F5
- White: #FFFFFF
- Primary Text: #24342B

Layout:
- Left sidebar for desktop
- Collapsible navigation for mobile
- Top navigation header
- Dashboard statistic cards
- Professional data tables
- Search and filter controls
- Modal forms
- Notification messages
- Loading indicators
- Confirmation dialogs
- Interactive maps

Display the application name:

CACAO INDUSTRY

Subtitle:
Farmer Profiling and GPS Plantation Mapping System

Location:
Isabela City, Basilan, Philippines

## 8. OFFLINE AND MOBILE FEATURES

Plan for future Android deployment through Capacitor.

Implement an offline-first architecture for field data collection.

Requirements:
- Support locally saved draft farmer profiles.
- Save GPS points locally when connectivity is interrupted.
- Use IndexedDB for structured offline records.
- Preserve incomplete GPS mapping sessions.
- Queue pending changes for synchronization.
- Synchronize once internet access returns.
- Avoid duplicate records during synchronization.
- Provide synchronization status.
- Resolve conflicts safely.
- Never silently overwrite conflicting plantation boundaries.
- Secure sensitive offline data.

Note that GPS positioning can function without an internet connection, but online map tiles may not be available unless offline map data has been prepared and licensed appropriately.

## 9. SECURITY AND DATA PRIVACY

Implement:
- Supabase Authentication
- Row Level Security
- Role-based permissions
- Secure farmer profile access
- Input validation
- Protection against XSS
- Safe file upload validation
- Secure account recovery
- Audit logging
- Personal data access restrictions
- Reasonable data retention rules
- Privacy notices and lawful processing workflows consistent with the Philippine Data Privacy Act of 2012

Do not publish exact private farmer home addresses or personal contact details on a public map.

Only authorized personnel should access sensitive farmer and worker information.

## 10. REQUIRED DEVELOPMENT OUTPUT

Generate actual working source code, not just explanations.

Provide:

1. Complete project folder structure.
2. Supabase PostgreSQL schema.
3. Authentication and user role functionality.
4. Professional responsive login page.
5. Administrator dashboard.
6. Farmer registration module.
7. Plantation registration module.
8. GPS walking boundary mapping.
9. Manual polygon drawing.
10. Automatic SQM and hectare calculation.
11. Database save and retrieval.
12. Secure row-level security policies.
13. Worker profiling module.
14. Cacao tree inventory.
15. Reports and printing.
16. Deployment instructions for GitHub and Vercel.
17. Capacitor Android preparation instructions.

IMPORTANT DEVELOPMENT RULES:

- Use real functioning JavaScript.
- Use real Supabase queries and database relationships.
- Do not use hardcoded sample data as operational records.
- Do not create fake buttons without functionality.
- Separate HTML, CSS, and JavaScript.
- Include comments explaining important modules.
- Use responsive, accessible layouts.
- Handle database errors properly.
- Handle GPS errors properly.
- Use secure authentication and role permissions.
- Keep database SQL compatible with Supabase PostgreSQL.
- Explain where each file belongs.
- Include all necessary dependencies and configuration instructions.
- Provide complete code for each generated file.
- Do not leave unfinished placeholder functions in implemented modules.

## 11. DEVELOPMENT ORDER

Build the system in functional phases.

PHASE 1:
- Project structure
- Supabase database schema
- RLS policies
- Authentication
- Professional dashboard

PHASE 2:
- Farmer profiling
- Farmer registration
- Profile photographs
- Farmer database operations

PHASE 3:
- Plantation registration
- Interactive Leaflet map
- GPS walking boundaries
- Manual polygon drawing
- Automatic land area calculation
- Saving boundaries to Supabase

PHASE 4:
- Cacao tree inventory
- Worker profiling
- Plantation statistics

PHASE 5:
- Reports and analytics
- Data exports
- Administrative approvals
- Audit logs

PHASE 6:
- Offline field collection
- Synchronization
- Android packaging with Capacitor
- Production security review
- Testing and deployment

## 12. START DEVELOPMENT NOW

First, inspect the existing VS Code project folder and preserve any existing working source files.

Then generate:
- The professional project directory structure
- Complete Supabase SQL database schema
- Secure RLS policies
- Login page
- Authentication JavaScript
- Dashboard HTML
- Dashboard CSS
- Dashboard JavaScript
- Farmer registration module

Ensure that Phase 1 works before moving to the next phase.

After Phase 1, prioritize the GPS walking and polygon mapping functionality, including automatic SQM and hectare calculation.

The final application should be suitable for real cacao plantation data collection, agricultural monitoring, and field operations in Isabela City, Basilan, Philippines.