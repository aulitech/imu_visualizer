**Cato IMU Visualizer**
A browser-based tool for visualizing real-time motion data from a Cato device. It connects directly over WebHID and renders the device's live orientation and raw sensor output.

**Features**
3D orientation visualizer — a 3D model mirrors the physical orientation of the connected Cato device in real time. Orientation is computed with a Madgwick sensor-fusion filter, combining gyroscope data (fast, tracks rotation) with accelerometer data (slow, corrects drift toward gravity).
Acceleration vector overlay — an optional arrow showing linear acceleration (total accelerometer reading minus the gravity component), visible only while the device is actively moving.
Live sensor chart — a scrolling chart of the most recent samples, with separate panels for gyroscope (°/s) and accelerometer (m/s²) readings.
Reset Orientation — re-zeros the current orientation estimate, returning the 3D model to its default pose.
In-app help panel — a quick reference covering connection, the 3D view, acceleration vectors, and the live chart.

**Requirements**
A Chromium-based browser (Chrome or Edge) — the app relies on the WebHID API, which isn't supported in Firefox or Safari.
A Cato device, paired via Bluetooth before connecting in-browser.

**Using the app**
Click Connect Cato to open the browser's device picker and select your Cato device.
Once connected, the 3D view and live chart begin updating from the device's sensor stream.
Use Reset Orientation at any time to re-zero the 3D model if it drifts.
Click Disconnect to end the session and stop the sensor stream.

**How it works**
The app talks to the device using the same OTA (Over-The-Air) feature-report protocol as Cato's other companion apps: commands are sent as text over HID feature reports, and the device streams back timestamped sensor input reports (report ID 7) containing accelerometer and gyroscope readings. A heartbeat is sent in response to periodic device status reports to keep the connection alive.

OTA command support beyond starting/stopping the sensor stream is in progress.
