import axios from 'axios';
import { API_ORIGIN } from '../api-base';

const API_URL = `${API_ORIGIN}/api/blocking`;

export const blockingApi = {
  async getDevices() {
    try {
      const response = await axios.get(`${API_URL}/devices`);
      return response.data;
    } catch (error) {
      console.error('Error fetching devices from API:', error);
      return null;
    }
  },

  async addDevice(device: any) {
    try {
      const response = await axios.post(`${API_URL}/devices`, device);
      return response.data;
    } catch (error) {
      console.error('Error adding device:', error);
      return null;
    }
  },

  async blockDevice(id: string, reason: string) {
    try {
      const response = await axios.put(`${API_URL}/devices`, { id, action: 'block', reason });
      return response.data;
    } catch (error) {
      console.error('Error blocking device:', error);
      return null;
    }
  },

  async unblockDevice(id: string) {
    try {
      const response = await axios.put(`${API_URL}/devices`, { id, action: 'unblock' });
      return response.data;
    } catch (error) {
      console.error('Error unblocking device:', error);
      return null;
    }
  },

  async enableKioskMode(id: string, allowedApps: string[]) {
    try {
      const response = await axios.put(`${API_URL}/devices`, { id, action: 'kiosk_enable', allowedApps });
      return response.data;
    } catch (error) {
      console.error('Error enabling kiosk mode:', error);
      return null;
    }
  },

  async disableKioskMode(id: string) {
    try {
      const response = await axios.put(`${API_URL}/devices`, { id, action: 'kiosk_disable' });
      return response.data;
    } catch (error) {
      console.error('Error disabling kiosk mode:', error);
      return null;
    }
  },

  async updateDeviceLocation(id: string, latitude: number, longitude: number) {
    try {
      const response = await axios.put(`${API_URL}/devices`, { id, action: 'update_location', latitude, longitude });
      return response.data;
    } catch (error) {
      console.error('Error updating location:', error);
      return null;
    }
  },

  async deleteDevice(id: string) {
    try {
      await axios.delete(`${API_URL}/devices?id=${id}`);
      return true;
    } catch (error) {
      console.error('Error deleting device:', error);
      return false;
    }
  },

  async getHistory(limit: number = 50) {
    try {
      const response = await axios.get(`${API_URL}/history?limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching history:', error);
      return null;
    }
  },

  async addHistoryEntry(entry: any) {
    try {
      const response = await axios.post(`${API_URL}/history`, entry);
      return response.data;
    } catch (error) {
      console.error('Error adding history entry:', error);
      return null;
    }
  },

  async getAlerts() {
    try {
      const response = await axios.get(`${API_URL}/data?type=alerts`);
      return response.data;
    } catch (error) {
      console.error('Error fetching alerts:', error);
      return null;
    }
  },

  async acknowledgeAlert(id: string) {
    try {
      await axios.post(`${API_URL}/data`, { type: 'acknowledge_alert', data: { id } });
      return true;
    } catch (error) {
      console.error('Error acknowledging alert:', error);
      return false;
    }
  },

  async registerPayment(deviceId: string, amount: number, method: string) {
    try {
      const response = await axios.post(`${API_URL}/data`, {
        type: 'payment',
        data: { deviceId, amount, method }
      });
      return response.data;
    } catch (error) {
      console.error('Error registering payment:', error);
      return null;
    }
  },

  async getPayments(deviceId?: string) {
    try {
      const url = deviceId 
        ? `${API_URL}/data?type=payments&deviceId=${deviceId}`
        : `${API_URL}/data?type=payments`;
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      console.error('Error fetching payments:', error);
      return null;
    }
  }
};
