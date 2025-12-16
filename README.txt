Skoda Homey App

A Homey app that integrates Skoda vehicles with the Homey smart home platform via the MySkoda Connect API.

OVERVIEW
--------
This app connects your Skoda vehicle to Homey, enabling you to monitor and control your car through Homey flows and automations. It provides real-time vehicle status updates and supports automatic charging management based on battery level and electricity prices.

FEATURES
--------
• Vehicle Status Monitoring
  - Lock/unlock status
  - Battery level and remaining range
  - Charging status and power
  - Door, trunk, bonnet, window, and light sensors

• Automatic Charging Control
  - Low battery threshold: Automatically start charging when battery drops below configured percentage
  - Low price charging: Charge during cheapest electricity hours (aWATTar API integration)
  - Priority system: Low battery charging takes precedence over price-based charging

• Real-time Updates
  - Vehicle status updates every 60 seconds
  - Electricity price updates every 15 minutes (when enabled)
  - Vehicle information refresh once per day

• Visual Integration
  - Vehicle image displayed as device card background
  - License plate and vehicle details stored in device settings

REQUIREMENTS
------------
• Homey device running firmware >=12.4.0
• Skoda Connect account with active vehicle
• Refresh token from Skoda Connect (obtained via OAuth2)

SETUP
-----
1. Install the app on your Homey device
2. Configure your Skoda Connect refresh token in app settings
3. Add your vehicle as a device (VIN is auto-detected)
4. Configure charging thresholds and preferences in device settings

TECHNICAL DETAILS
-----------------
• API: MySkoda Connect (mysmob.api.connect.skoda-auto.cz)
• Authentication: OAuth2 with refresh token
• Update Intervals: 60s (status), 15m (prices), 24h (vehicle info)
• SDK: Homey SDK 3
