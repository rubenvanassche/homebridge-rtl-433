require("@babel/polyfill");

let Service: any, Characteristic: any;

export default function (homebridge: any) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerPlatform("rtl", "RTL", RTLPlatform);
}

class Device {
    name: string;
    watch_battery: boolean;

    id: number | null;
    rid: number | null;
    model: string | null;
    channel: number | null;

    constructor(device) {
        this.name = device['name'];
        this.watch_battery = device['watch_battery'] ? device['watch_battery'] : false;

        this.id = device['id'] ? device['id'] : null;
        this.channel = device['channel'] ? device['channel'] : null;
        this.rid = device['rid'] ? device['rid'] : null;
        this.model = device['model'] ? device['model'] : null;
    }

    isDevice(message): boolean {
        return this.propertyIsEqual(message.id, this.id)
            && this.propertyIsEqual(message.channel, this.channel)
            && this.propertyIsEqual(message.rid, this.rid)
            && this.propertyIsEqual(message.model, this.model);
    }

    private propertyIsEqual(a, b): boolean {
        if (!a || !b) {
            return true;
        }

        return a === b;
    }
}

class Translation {
    humidity: string;
    temperature: string;

    constructor(humidity, temperature) {
        this.humidity = humidity ? humidity : 'humidity';
        this.temperature = temperature ? temperature : 'temperature';
    }
}

class RTLPlatform {
    log: Function;
    devices: [RTLAccessory];
    server: RTLServer;
    translation: Translation;

    constructor(log, config) {
        this.log = log;
        this.translation = new Translation(
            config["translations"]["humidity"],
            config["translations"]["temperature"],
        );
        this.devices = config["devices"].map((device) => {
            return new RTLAccessory(
                new Device(device),
                this.log,
                this.translation
            )
        });
        this.server = new RTLServer(this.devices, this.log);
    }

    accessories(callback) {
        callback(this.devices);

        this.server.execute();
    }
}

class RTLServer {
    log: any;
    devices: [RTLAccessory];

    constructor(devices: [RTLAccessory], log: any) {
        this.devices = devices;
        this.log = log;
    }

    execute() {
        this.log('Starting rtl_433 server...');

        let ChildProcess = require('child_process');
        let ReadLine = require('readline');

        let proc = ChildProcess.spawn('pkill rtl_433;/usr/local/bin/rtl_433', ['-q', '-F', 'json', '-C', 'si'], {
            shell: true
        });

        ReadLine.createInterface({
            input: proc.stdout,
            terminal: false
        }).on('line', (message) => {
            if (!message.toString().startsWith('{')) {
                this.log(`Received non-json message: ${message.toString()}`)
            }

            try {
                let data = JSON.parse(message.toString());

                let device = this.devices.find(device => {
                    return device.device.isDevice(data);
                });

                if (device === undefined) {
                    this.log(`Device not found, message: ${message.toString()}`);

                    return;
                }

                device.updateState(data);
            } catch (err) {
                this.log.error(`JSON Parse Error ${err} in message: ${message.toString()}`);
            }
        });

        proc.on('close', (code) => {
            this.log.error('child close code (spawn)', code);
        });

        proc.on('disconnect', (code) => {
            this.log.error('child disconnect code (spawn)', code);
        });

        proc.on('error', (code) => {
            this.log.error('child error code (spawn)', code);
        });

        proc.on('exit', (code) => {
            this.log.error('child exit code (spawn)', code);
        });
    }
}

class RTLAccessory {
    // Properties
    name: string;
    device: Device;

    // Translations
    translation: Translation;

    // Util
    log: Function;

    // Services exposed.
    informationService: any;
    temperatureService: any;
    humidityService: any;

    constructor(device: Device, log: Function, translation: Translation) {
        this.name = device.name;
        this.device = device;

        this.log = log;

        this.translation = translation;

        this.informationService = new Service.AccessoryInformation();
        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, "Ruben Van Assche")
            .setCharacteristic(Characteristic.SerialNumber, 'rtl-temperature-' + this.device.id + '-' + this.device.channel)
            .setCharacteristic(Characteristic.FirmwareRevision, '1.0');

        this.temperatureService = new Service.TemperatureSensor(`${this.name} ${this.translation.temperature}`, this.translation.temperature);
        this.temperatureService
            .setCharacteristic(Characteristic.CurrentTemperature, 0);

        this.humidityService = new Service.HumiditySensor(`${this.name} ${this.translation.humidity}`, this.translation.humidity);
        this.humidityService
            .setCharacteristic(Characteristic.CurrentRelativeHumidity, 0);
    }

    updateState(data) {
        this.log('Update:', this.device);

        this.temperatureService
            .setCharacteristic(Characteristic.CurrentTemperature, data.temperature_C);

        this.humidityService
            .setCharacteristic(Characteristic.CurrentRelativeHumidity, data.humidity);

        if (!this.device.watch_battery) {
            return;
        }

        let batteryStatus = data.battery === "OK"
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;

        this.temperatureService.setCharacteristic(
            Characteristic.StatusLowBattery,
            batteryStatus
        );

        this.humidityService.setCharacteristic(
            Characteristic.StatusLowBattery,
            batteryStatus
        );
    }

    getServices() {
        return [
            this.informationService,
            this.temperatureService,
            this.humidityService,
        ];
    }
}
